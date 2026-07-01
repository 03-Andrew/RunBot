import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "./storage";
import { getStoredStravaActivitiesByDiscordId } from "./stravaApi";
import {
  getCurrentWeekStartUnixSeconds,
  calculateWeeklyStats,
  getActivityTimestamp,
  formatDistanceKm,
  formatCompactDistanceKm,
  formatTotalTime,
  formatPacePerKm,
} from "./stravaFormatting";
import { callDeepSeek } from "./ai/deepseek";
import { postDiscordMessage } from "./discord";
import { createLogger, type Logger } from "./logger";

declare const process: {
  env: {
    DISCORD_BOT_TOKEN?: string;
    DISCORD_CHANNEL_ID?: string;
    DEEPSEEK_API_KEY?: string;
  };
};

const MAX_MSG = 1900;

const formatDateShort = (unixSeconds: number): string => {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const buildHeader = (weekStart: number): string => {
  const weekEnd = weekStart + 7 * 24 * 60 * 60;
  return `:bar_chart: **Weekly Run Recap** (${formatDateShort(weekStart)} - ${formatDateShort(weekEnd)})\n`;
};

const getPastWeekStart = (): number => {
  return getCurrentWeekStartUnixSeconds() - 7 * 24 * 60 * 60;
};

const buildAthleteEntry = async (
  discordUserId: string,
  weekStart: number,
  log: Logger
): Promise<string> => {
  const mention = `<@${discordUserId}>`;
  const weekStartMs = weekStart * 1000;
  const weekEndMs = (weekStart + 7 * 24 * 60 * 60) * 1000;

  const activities = await getStoredStravaActivitiesByDiscordId(discordUserId);
  const weekActivities = activities.filter((a) => {
    const ts = getActivityTimestamp(a);
    return ts >= weekStartMs && ts < weekEndMs;
  });

  const stats = calculateWeeklyStats(weekActivities, weekStart);

  if (stats.runCount === 0) {
    return `**${mention}**\n:zzz: No runs this week.`;
  }

  const lines = [
    `:runner: **${mention}**`,
    `  ${formatDistanceKm(stats.distanceMeters)} · ${stats.runCount} run${stats.runCount > 1 ? "s" : ""}`,
    `  Avg pace: ${formatPacePerKm(stats.movingTimeSeconds, stats.distanceMeters)} · Longest: ${formatCompactDistanceKm(stats.longestRunMeters)}`,
    `  Time: ${formatTotalTime(stats.elapsedTimeSeconds)}`,
  ];

  try {
    const ai = await callDeepSeek(
      [{ role: "user", content: recapPrompt(mention, stats) }],
      undefined,
      log
    );
    const insight = ai.content?.trim();
    if (insight) {
      lines.push(`:bulb: ${insight}`);
    }
  } catch (err: any) {
    log.error("DeepSeek recap failed", { discordUserId, error: err.message });
  }

  return lines.join("\n");
};

const recapPrompt = (
  mention: string,
  stats: ReturnType<typeof calculateWeeklyStats>
): string =>
  [
    "You are a concise, encouraging running coach.",
    "Describe the week of running activity. Be specific. Keep it under 500 chars.",
    "",
    `Athlete: ${mention}`,
    `Distance: ${(stats.distanceMeters / 1000).toFixed(1)} km`,
    `Runs: ${stats.runCount}`,
    `Moving time: ${Math.round(stats.movingTimeSeconds / 60)} min`,
    `Longest run: ${(stats.longestRunMeters / 1000).toFixed(1)} km`,
  ].join("\n");

export const handler = async (): Promise<void> => {
  const log = createLogger(`weekly-recap-${new Date().toISOString().slice(0, 10)}`);

  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!channelId) {
    log.error("DISCORD_CHANNEL_ID not set");
    return;
  }

  const weekStart = getPastWeekStart();
  const header = buildHeader(weekStart);

  const scan = await db.send(
    new ScanCommand({
      TableName: "ActivityBot",
      FilterExpression: "SK = :sk",
      ExpressionAttributeValues: { ":sk": "PROFILE" },
      ProjectionExpression: "PK",
    })
  );

  const items = scan.Items ?? [];
  const athleteIds = items.map(
    (i) => (i.PK as string).replace("USER#", "")
  );

  if (athleteIds.length === 0) {
    log.info("No linked athletes found for weekly recap");
    await postDiscordMessage(channelId, `${header}No linked athletes yet. Use \`/strava\` to connect.`);
    return;
  }

  log.info("Generating weekly recap", { athleteCount: athleteIds.length });

  const entries: string[] = [];
  for (const id of athleteIds) {
    try {
      entries.push(await buildAthleteEntry(id, weekStart, log));
    } catch (err: any) {
      log.error("Recap failed for athlete", { discordUserId: id, error: err.message });
      entries.push(`**<@${id}>**\n:warning: Could not load data.`);
    }
  }

  const messages = [header];
  for (const entry of entries) {
    if (messages[messages.length - 1].length + entry.length + 3 > MAX_MSG) {
      messages.push(entry);
    } else {
      messages[messages.length - 1] += `\n---\n\n${entry}`;
    }
  }

  for (const msg of messages) {
    await postDiscordMessage(channelId, msg);
  }

  log.info("Weekly recap posted", { athleteCount: athleteIds.length, messageCount: messages.length });
};
