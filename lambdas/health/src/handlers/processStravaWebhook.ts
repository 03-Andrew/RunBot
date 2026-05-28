import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { buildClubActivitiesMessageForClub } from "../stravaClubActivitiesMessage";
import { db } from "../storage";
import { buildStravaActivityMessage } from "../stravaActivityMessage";
import {
  fetchStravaActivity,
  fetchStravaActivitiesSince,
  getClubActivitiesById,
  getClubById,
  getLinkedStravaUserByDiscordId,
  getStoredStravaActivitiesByDiscordId,
  type StravaActivity,
  type StravaUserRecord,
} from "../stravaApi";
import { isStravaWebhookJob, type StravaWebhookJob } from "../stravaWebhookJob";
import {
  isDiscordSlashCommandJob,
  type DiscordSlashCommandJob,
} from "../discordSlashCommandJob";
import {
  calculateWeeklyStats,
  buildWeeklyStatsMessage,
  getCurrentWeekStartUnixSeconds,
} from "../stravaStats";
import { postDiscordInteractionFollowUp } from "../discordFollowup";

declare const process: {
  env: {
    DISCORD_BOT_TOKEN?: string;
    DISCORD_CHANNEL_ID?: string;
    AI_COACH_URL?: string;
    AI_COACH_TOKEN?: string;
  };
};

const DEFAULT_CLUB_ID = "1600752";
const RECENT_LOOKBACK_DAYS = 30;

const postDiscordMessage = async (content: string) => {
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CHANNEL_ID) {
    throw new Error("Discord notification is not configured.");
  }

  return fetch(
    `https://discord.com/api/v10/channels/${process.env.DISCORD_CHANNEL_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    }
  );
};

const isRunningActivity = (activity: StravaActivity) => {
  const labels = [activity.type, activity.sport_type].filter(
    (label): label is string => typeof label === "string"
  );

  return labels.some((label) => /run/i.test(label));
};

const getActivityTimestamp = (activity: StravaActivity & { UpdatedAt?: string }) => {
  if (activity.start_date) {
    const startedAt = new Date(activity.start_date).getTime();
    if (!Number.isNaN(startedAt)) {
      return startedAt;
    }
  }

  if (activity.UpdatedAt) {
    const updatedAt = new Date(activity.UpdatedAt).getTime();
    if (!Number.isNaN(updatedAt)) {
      return updatedAt;
    }
  }

  return 0;
};

const dedupeAndSortRuns = (
  activities: Array<StravaActivity & { UpdatedAt?: string }>
) => {
  const deduped = new Map<number, StravaActivity & { UpdatedAt?: string }>();

  for (const activity of activities) {
    if (typeof activity.id !== "number") {
      continue;
    }

    if (!isRunningActivity(activity)) {
      continue;
    }

    const existing = deduped.get(activity.id);
    if (!existing || getActivityTimestamp(activity) > getActivityTimestamp(existing)) {
      deduped.set(activity.id, activity);
    }
  }

  return [...deduped.values()].sort(
    (a, b) => getActivityTimestamp(b) - getActivityTimestamp(a)
  );
};

const callAiCoach = async (payload: unknown) => {
  if (!process.env.AI_COACH_URL) {
    throw new Error("AI coach endpoint is not configured.");
  }

  const response = await fetch(process.env.AI_COACH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-runbot-ai-token": process.env.AI_COACH_TOKEN ?? "",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`AI coach failed: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as { analysis?: string };
  return data.analysis ?? "";
};

const handleWebhookJob = async (job: StravaWebhookJob) => {
  if (job.objectType !== "activity" || !["create", "update"].includes(job.aspectType)) {
    console.log("Ignoring non-notifiable Strava webhook job", job);
    return;
  }

  const result = await db.send(
    new QueryCommand({
      TableName: "ActivityBot",
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `STRAVA#${job.ownerId}`,
      },
    })
  );

  const user = result.Items?.[0];

  if (!user) {
    console.log("No linked Discord user found for Strava owner", {
      ownerId: job.ownerId,
    });
    return;
  }

  const typedUser = user as StravaUserRecord;
  const discordUserId = user.DiscordID ?? typedUser.PK.replace("USER#", "");
  const activity = await fetchStravaActivity(typedUser, job.activityId);

  await db.send(
    new PutCommand({
      TableName: "ActivityBot",
      Item: {
        PK: `USER#${discordUserId}`,
        SK: `ACTIVITY#${activity.id}`,
        DiscordID: discordUserId,
        UpdatedAt: new Date().toISOString(),
        ...activity,
      },
    })
  );

  const discordResponse = await postDiscordMessage(
    buildStravaActivityMessage(activity, discordUserId)
  );

  if (!discordResponse.ok) {
    const errorBody = await discordResponse.text();
    throw new Error(
      `Discord message failed: ${discordResponse.status} ${errorBody}`
    );
  }

  console.log("Discord message sent for Strava activity", {
    ownerId: job.ownerId,
    activityId: job.activityId,
  });
};

const handleDiscordSlashCommandJob = async (job: DiscordSlashCommandJob) => {
  const user = await getLinkedStravaUserByDiscordId(job.discordUserId);

  if (!user && job.commandName !== "ai-chat") {
    const response = await postDiscordInteractionFollowUp(
      job.interactionToken,
      "No Strava account is linked yet. Run `/strava` first."
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Discord follow-up failed: ${response.status} ${errorBody}`
      );
    }

    return;
  }

  const linkedUser = user as NonNullable<typeof user>;

  try {
    if (job.commandName === "ai-chat") {
      const analysis = await callAiCoach({
        prompt: job.prompt ?? "",
        discordUserId: job.discordUserId,
      });

      const response = await postDiscordInteractionFollowUp(
        job.interactionToken,
        analysis || "Could not generate a response right now."
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Discord follow-up failed: ${response.status} ${errorBody}`
        );
      }

      return;
    }

    if (job.commandName === "stats") {
      const afterUnixSeconds = getCurrentWeekStartUnixSeconds();
      const activities = await fetchStravaActivitiesSince(linkedUser, afterUnixSeconds);
      const response = await postDiscordInteractionFollowUp(
        job.interactionToken,
        buildWeeklyStatsMessage(activities)
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Discord follow-up failed: ${response.status} ${errorBody}`
        );
      }

      return;
    }

    if (job.commandName === "analyse-run") {
      const lookbackSince = Math.floor(Date.now() / 1000) - RECENT_LOOKBACK_DAYS * 24 * 60 * 60;
      const [recentActivities, storedActivities] = await Promise.all([
        fetchStravaActivitiesSince(linkedUser, lookbackSince),
        getStoredStravaActivitiesByDiscordId(job.discordUserId),
      ]);

      const allRuns = dedupeAndSortRuns([...recentActivities, ...storedActivities]);
      const recentRuns = allRuns.slice(0, 5);
      const historicalRuns = allRuns.slice(5, 15);
      const latestRun = recentRuns[0] ?? historicalRuns[0];
      const weeklySummary = calculateWeeklyStats(recentActivities);

      if (!latestRun) {
        const response = await postDiscordInteractionFollowUp(
          job.interactionToken,
          "I could not find enough run history to analyse yet."
        );

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `Discord follow-up failed: ${response.status} ${errorBody}`
          );
        }

        return;
      }

      const analysis = await callAiCoach({
        athleteName: "unknown",
        latestRun,
        recentRuns,
        historicalRuns,
        weeklySummary,
      });

      const response = await postDiscordInteractionFollowUp(
        job.interactionToken,
        analysis || "Could not generate a run analysis right now."
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Discord follow-up failed: ${response.status} ${errorBody}`
        );
      }

      return;
    }

    const club = await getClubById(linkedUser, DEFAULT_CLUB_ID);
    const activities = await getClubActivitiesById(linkedUser, DEFAULT_CLUB_ID, 1, 30);
    const response = await postDiscordInteractionFollowUp(
      job.interactionToken,
      buildClubActivitiesMessageForClub(
        activities,
        club.name ?? "",
        DEFAULT_CLUB_ID
      )
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Discord follow-up failed: ${response.status} ${errorBody}`
      );
    }
  } catch (error) {
    console.error("Failed to process Discord slash command", {
      commandName: job.commandName,
      discordUserId: job.discordUserId,
      error,
    });

    const response = await postDiscordInteractionFollowUp(
      job.interactionToken,
      job.commandName === "stats"
        ? "Could not load your weekly Strava stats right now."
        : "Could not load club activities right now."
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Discord follow-up failed: ${response.status} ${errorBody}`
      );
    }
  }
};

export const handleProcessStravaWebhook = async (event: {
  Records?: Array<{ body?: string }>;
}) => {
  for (const record of event.Records ?? []) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(record.body ?? "{}");
    } catch (error) {
      throw new Error(`Invalid SQS message body: ${String(error)}`);
    }

    if (isStravaWebhookJob(parsed)) {
      await handleWebhookJob(parsed);
      continue;
    }

    if (isDiscordSlashCommandJob(parsed)) {
      await handleDiscordSlashCommandJob(parsed);
      continue;
    }

    throw new Error("Invalid queue job");
  }
};
