import {
  getLinkedStravaUserByDiscordId,
  getStoredPersonalRecordsByDiscordId,
  getStoredStravaActivitiesByDiscordId,
  type StravaActivity,
  type StravaUserRecord,
} from "./stravaApi";
import { calculateWeeklyStats, getCurrentWeekStartUnixSeconds } from "./stravaStats";

declare const process: {
  env: {
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
  };
};

type GeminiFunctionCall = {
  name?: string;
  args?: Record<string, unknown>;
};

type GeminiPart = {
  text?: string;
  functionCall?: GeminiFunctionCall;
  function_call?: GeminiFunctionCall;
  functionResponse?: {
    name?: string;
    response?: Record<string, unknown>;
  };
};

type GeminiContent = {
  role?: string;
  parts?: GeminiPart[];
};

type RunSummary = {
  id?: number;
  name?: string;
  startDate?: string;
  type?: string;
  sportType?: string;
  distanceKm?: number;
  movingTimeSeconds?: number;
  elapsedTimeSeconds?: number;
  pacePerKm?: string;
  duration?: string;
  prCount?: number;
  totalElevationGain?: number;
};

type WeeklyStatsSummary = {
  distanceKm: number;
  runCount: number;
  movingTimeSeconds: number;
  elapsedTimeSeconds: number;
  longestRunKm: number;
  averagePacePerKm: string;
};

type RunComparisonSummary = {
  latestRun?: RunSummary;
  baselineRuns: RunSummary[];
  latestPacePerKm?: string;
  baselineAveragePacePerKm?: string;
  paceDeltaSecondsPerKm?: number;
  latestDistanceKm?: number;
  baselineAverageDistanceKm?: number;
  note?: string;
};

type AgentContext = {
  discordUserId: string;
  linkedStravaUser?: StravaUserRecord;
};

const MAX_TOOL_CALLS = 4;
const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_RECENT_LIMIT = 5;
const DEFAULT_BASELINE_COUNT = 5;

const isRunningActivity = (activity: StravaActivity) => {
  const labels = [activity.type, activity.sport_type].filter(
    (label): label is string => typeof label === "string"
  );

  return labels.some((label) => /run/i.test(label));
};

const getActivityTimestamp = (activity: StravaActivity) => {
  if (!activity.start_date) {
    return 0;
  }

  const timestamp = new Date(activity.start_date).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const dedupeAndSortRuns = (activities: StravaActivity[]) => {
  const deduped = new Map<number, StravaActivity>();

  for (const activity of activities) {
    if (typeof activity.id !== "number" || !isRunningActivity(activity)) {
      continue;
    }

    const existing = deduped.get(activity.id);
    if (!existing || getActivityTimestamp(activity) > getActivityTimestamp(existing)) {
      deduped.set(activity.id, activity);
    }
  }

  return [...deduped.values()].sort((a, b) => getActivityTimestamp(b) - getActivityTimestamp(a));
};

const formatPace = (movingTimeSeconds?: number, distanceMeters?: number) => {
  if (!movingTimeSeconds || !distanceMeters || distanceMeters <= 0) {
    return undefined;
  }

  const secondsPerKm = Math.round(movingTimeSeconds / (distanceMeters / 1000));
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
};

const formatDuration = (seconds?: number) => {
  if (seconds == null || Number.isNaN(seconds) || seconds <= 0) {
    return undefined;
  }
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
};

const summarizeRun = (run: StravaActivity): RunSummary => ({
  id: run.id,
  name: run.name,
  startDate: run.start_date,
  type: run.type,
  sportType: run.sport_type,
  distanceKm: run.distance != null ? run.distance / 1000 : undefined,
  movingTimeSeconds: run.moving_time,
  elapsedTimeSeconds: run.elapsed_time,
  pacePerKm: formatPace(run.moving_time, run.distance),
  duration: formatDuration(run.moving_time),
  prCount: run.pr_count,
  totalElevationGain: run.total_elevation_gain,
});

const summarizeRuns = (runs: StravaActivity[]) => runs.map(summarizeRun);

const loadRunHistory = async (
  user: StravaUserRecord,
  discordUserId: string,
  lookbackDays: number
) => {
  const storedActivities = await getStoredStravaActivitiesByDiscordId(discordUserId);
  const runs = dedupeAndSortRuns(storedActivities);

  const afterUnixSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
  return runs.filter(run => {
    const ts = getActivityTimestamp(run) / 1000;
    return ts >= afterUnixSeconds;
  });
};

const getLatestRun = async (context: AgentContext) => {
  if (!context.linkedStravaUser) {
    return {
      error: "No linked Strava account is available for this user.",
    };
  }

  const runs = await loadRunHistory(
    context.linkedStravaUser,
    context.discordUserId,
    DEFAULT_LOOKBACK_DAYS
  );
  const latestRun = runs[0];

  return {
    latestRun: latestRun ? summarizeRun(latestRun) : undefined,
    recentRuns: summarizeRuns(runs.slice(0, DEFAULT_RECENT_LIMIT)),
    note: latestRun ? undefined : "No running activity was found in the lookback window.",
  };
};

const getRecentRuns = async (
  context: AgentContext,
  args: Record<string, unknown>
) => {
  if (!context.linkedStravaUser) {
    return {
      error: "No linked Strava account is available for this user.",
    };
  }

  const limit = Number(args.limit);
  const lookbackDays = Number(args.lookbackDays);
  const runLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 15) : DEFAULT_RECENT_LIMIT;
  const safeLookbackDays =
    Number.isFinite(lookbackDays) && lookbackDays > 0
      ? Math.min(Math.floor(lookbackDays), 365)
      : DEFAULT_LOOKBACK_DAYS;

  const runs = await loadRunHistory(
    context.linkedStravaUser,
    context.discordUserId,
    safeLookbackDays
  );

  return {
    latestRun: runs[0] ? summarizeRun(runs[0]) : undefined,
    recentRuns: summarizeRuns(runs.slice(0, runLimit)),
    note: runs.length === 0 ? "No running activity was found in the lookback window." : undefined,
  };
};

const getWeeklyStats = async (context: AgentContext): Promise<{ weeklyStats?: WeeklyStatsSummary; error?: string }> => {
  if (!context.linkedStravaUser) {
    return {
      error: "No linked Strava account is available for this user.",
    };
  }

  const storedActivities = await getStoredStravaActivitiesByDiscordId(context.discordUserId);
  const afterUnixSeconds = getCurrentWeekStartUnixSeconds();
  const thisWeekActivities = storedActivities.filter(act => {
    const ts = new Date(act.start_date || 0).getTime() / 1000;
    return ts >= afterUnixSeconds;
  });

  const stats = calculateWeeklyStats(thisWeekActivities);

  return {
    weeklyStats: {
      distanceKm: stats.distanceMeters / 1000,
      runCount: stats.runCount,
      movingTimeSeconds: stats.movingTimeSeconds,
      elapsedTimeSeconds: stats.elapsedTimeSeconds,
      longestRunKm: stats.longestRunMeters / 1000,
      averagePacePerKm: formatPace(stats.movingTimeSeconds, stats.distanceMeters) ?? "n/a",
    },
  };
};

const compareToPastRuns = async (
  context: AgentContext,
  args: Record<string, unknown>
): Promise<{ comparison?: RunComparisonSummary; error?: string }> => {
  if (!context.linkedStravaUser) {
    return {
      error: "No linked Strava account is available for this user.",
    };
  }

  const lookbackDays = Number(args.lookbackDays);
  const baselineRunCount = Number(args.baselineRunCount);
  const safeLookbackDays =
    Number.isFinite(lookbackDays) && lookbackDays > 0
      ? Math.min(Math.floor(lookbackDays), 365)
      : DEFAULT_LOOKBACK_DAYS;
  const safeBaselineCount =
    Number.isFinite(baselineRunCount) && baselineRunCount > 0
      ? Math.min(Math.floor(baselineRunCount), 20)
      : DEFAULT_BASELINE_COUNT;

  const runs = await loadRunHistory(
    context.linkedStravaUser,
    context.discordUserId,
    safeLookbackDays
  );
  const latestRun = runs[0];

  if (!latestRun) {
    return {
      comparison: {
        baselineRuns: [],
        note: "No running activity was found in the lookback window.",
      },
    };
  }

  const baselineRuns = runs.slice(1, 1 + safeBaselineCount);
  const paceValues = baselineRuns
    .map((run) => ({
      paceSecondsPerKm:
        run.moving_time != null && run.distance != null && run.distance > 0
          ? run.moving_time / (run.distance / 1000)
          : undefined,
      distanceKm: run.distance != null ? run.distance / 1000 : undefined,
    }))
    .filter((entry) => typeof entry.paceSecondsPerKm === "number" && typeof entry.distanceKm === "number");

  const paceAverage =
    paceValues.length > 0
      ? paceValues.reduce((sum, entry) => sum + (entry.paceSecondsPerKm ?? 0), 0) / paceValues.length
      : undefined;
  const distanceAverage =
    paceValues.length > 0
      ? paceValues.reduce((sum, entry) => sum + (entry.distanceKm ?? 0), 0) / paceValues.length
      : undefined;
  const latestPaceSecondsPerKm =
    latestRun.moving_time != null && latestRun.distance != null && latestRun.distance > 0
      ? latestRun.moving_time / (latestRun.distance / 1000)
      : undefined;

  return {
    comparison: {
      latestRun: summarizeRun(latestRun),
      baselineRuns: summarizeRuns(baselineRuns),
      latestPacePerKm: formatPace(latestRun.moving_time, latestRun.distance),
      baselineAveragePacePerKm:
        paceAverage != null ? formatPace(paceAverage, 1000) : undefined,
      paceDeltaSecondsPerKm:
        paceAverage != null && latestPaceSecondsPerKm != null
          ? latestPaceSecondsPerKm - paceAverage
          : undefined,
      latestDistanceKm: latestRun.distance != null ? latestRun.distance / 1000 : undefined,
      baselineAverageDistanceKm: distanceAverage,
    },
  };
};

const getPersonalRecords = async (context: AgentContext) => {
  if (!context.linkedStravaUser) {
    return {
      error: "No linked Strava account is available for this user.",
    };
  }

  // 1. Try to load pre-computed Materialized View from DynamoDB
  try {
    const prRecord = await getStoredPersonalRecordsByDiscordId(context.discordUserId);
    if (prRecord?.personalRecords) {
      const prs = prRecord.personalRecords;
      console.log(`Loaded pre-computed PRs from DynamoDB for user ${context.discordUserId}`);
      return {
        personalRecords: {
          longestRun: prs.longestRun ? summarizeRun(prs.longestRun) : undefined,
          biggestClimb: prs.biggestClimb ? summarizeRun(prs.biggestClimb) : undefined,
          best5k: prs.best5k ? summarizeRun(prs.best5k) : undefined,
          best10k: prs.best10k ? summarizeRun(prs.best10k) : undefined,
          bestHalfMarathon: prs.bestHalfMarathon ? summarizeRun(prs.bestHalfMarathon) : undefined,
        },
      };
    }
  } catch (error: any) {
    console.error(`Failed to read pre-computed PRs for user ${context.discordUserId}:`, error.message);
  }

  // 2. Fallback to on-the-fly calculations if the pre-computed record is missing (self-healing)
  console.log(`Materialized PR record not found. Falling back to on-the-fly calculations for user ${context.discordUserId}`);
  const activities = await getStoredStravaActivitiesByDiscordId(context.discordUserId);
  const runs = dedupeAndSortRuns(activities);

  if (runs.length === 0) {
    return {
      personalRecords: {},
      note: "No running activity history found in the database.",
    };
  }

  let longestRun = runs[0];
  let best5k: StravaActivity | undefined;
  let best5kPaceSeconds = Infinity;
  let best10k: StravaActivity | undefined;
  let best10kPaceSeconds = Infinity;
  let bestHalf: StravaActivity | undefined;
  let bestHalfPaceSeconds = Infinity;
  let biggestClimb = runs[0];

  for (const run of runs) {
    const distM = run.distance ?? 0;
    const timeS = run.moving_time ?? 0;
    const climbM = run.total_elevation_gain ?? 0;

    if (distM > (longestRun.distance ?? 0)) {
      longestRun = run;
    }
    if (climbM > (biggestClimb.total_elevation_gain ?? 0)) {
      biggestClimb = run;
    }

    if (timeS > 0 && distM > 0) {
      const paceSecondsPerKm = timeS / (distM / 1000);

      // Check 5k (>= 4900m to allow for minor GPS/track rounding)
      if (distM >= 4900) {
        if (paceSecondsPerKm < best5kPaceSeconds) {
          best5kPaceSeconds = paceSecondsPerKm;
          best5k = run;
        }
      }

      // Check 10k (>= 9900m)
      if (distM >= 9900) {
        if (paceSecondsPerKm < best10kPaceSeconds) {
          best10kPaceSeconds = paceSecondsPerKm;
          best10k = run;
        }
      }

      // Check Half Marathon (>= 20900m)
      if (distM >= 20900) {
        if (paceSecondsPerKm < bestHalfPaceSeconds) {
          bestHalfPaceSeconds = paceSecondsPerKm;
          bestHalf = run;
        }
      }
    }
  }

  return {
    personalRecords: {
      longestRun: summarizeRun(longestRun),
      biggestClimb: summarizeRun(biggestClimb),
      best5k: best5k ? summarizeRun(best5k) : undefined,
      best10k: best10k ? summarizeRun(best10k) : undefined,
      bestHalfMarathon: bestHalf ? summarizeRun(bestHalf) : undefined,
    },
  };
};

const TOOL_DECLARATIONS = [
  {
    name: "get_personal_records",
    description:
      "Get the user's all-time running personal records (PRs) computed from database history, including longest run, biggest climb, and fastest 5k/10k/Half Marathon.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_latest_run",
    description:
      "Get the user's most recent running activity and a small recent-run sample for context.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_recent_runs",
    description:
      "Get a list of recent running activities for comparison, pacing, and trend analysis.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of runs to return. Clamp this to a small number.",
        },
        lookbackDays: {
          type: "number",
          description: "How far back to search for running activities, in days.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_weekly_stats",
    description:
      "Get the user's weekly running volume, count, total time, longest run, and average pace.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "compare_to_past_runs",
    description:
      "Compare the user's latest run with a baseline of prior runs to estimate whether it was faster, slower, easier, or heavier than usual.",
    parameters: {
      type: "object",
      properties: {
        baselineRunCount: {
          type: "number",
          description: "How many prior runs to use as the comparison baseline.",
        },
        lookbackDays: {
          type: "number",
          description: "How far back to search for runs before building the baseline, in days.",
        },
      },
      required: [],
    },
  },
] as const;

const getFunctionCalls = (content: GeminiContent) =>
  (content.parts ?? [])
    .map((part) => part.functionCall ?? part.function_call)
    .filter((call): call is GeminiFunctionCall => Boolean(call && call.name));

const getText = (content: GeminiContent) =>
  (content.parts ?? [])
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .join("\n");

const executeTool = async (context: AgentContext, call: GeminiFunctionCall) => {
  const args = call.args ?? {};

  if (call.name === "get_personal_records") {
    return { result: await getPersonalRecords(context) };
  }

  if (call.name === "get_latest_run") {
    return { result: await getLatestRun(context) };
  }

  if (call.name === "get_recent_runs") {
    return { result: await getRecentRuns(context, args) };
  }

  if (call.name === "get_weekly_stats") {
    return { result: await getWeeklyStats(context) };
  }

  if (call.name === "compare_to_past_runs") {
    return { result: await compareToPastRuns(context, args) };
  }

  return { error: `Unknown tool: ${call.name}` };
};

const buildSystemInstruction = (hasLinkedStrava: boolean) =>
  [
    "You are RunBot, a concise conversational running coach inside Discord.",
    "Respond in clear markdown.",
    "Use tools when the user's question needs current, recent, or comparative Strava data.",
    "If a linked Strava account is available, you may reference the user's recent runs, weekly trends, or all-time personal records.",
    hasLinkedStrava
      ? "A linked Strava account is available for this user."
      : "No linked Strava account is available. Do not claim to know the user's personal run data. If the user asks about their own runs, tell them to connect Strava with /strava first.",
    "Keep answers concise and practical.",
    "When the user asks for analysis, pace, trend, or comparison, be specific about what the data supports.",
  ].join("\n");

const callGemini = async (
  contents: GeminiContent[],
  hasLinkedStrava: boolean
): Promise<{ content?: GeminiContent; text?: string }> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${
      process.env.GEMINI_MODEL ?? "gemini-2.5-flash"
    }:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text: buildSystemInstruction(hasLinkedStrava),
            },
          ],
        },
        contents,
        tools: [
          {
            functionDeclarations: TOOL_DECLARATIONS,
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: "AUTO",
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: GeminiContent;
      text?: string;
    }>;
  };

  const candidate = data.candidates?.[0];
  return {
    content: candidate?.content,
    text: candidate?.text,
  };
};

export const runNaturalLanguageAi = async (
  prompt: string,
  discordUserId: string
) => {
  const linkedStravaUser = await getLinkedStravaUserByDiscordId(discordUserId);
  const context: AgentContext = {
    discordUserId,
    linkedStravaUser,
  };

  const history: GeminiContent[] = [
    {
      role: "user",
      parts: [{ text: prompt }],
    },
  ];

  let finalText = "";

  for (let iteration = 0; iteration < MAX_TOOL_CALLS; iteration += 1) {
    const response = await callGemini(history, Boolean(linkedStravaUser));
    const content = response.content;

    if (!content) {
      return finalText || response.text || "Could not generate a response right now.";
    }

    const functionCalls = getFunctionCalls(content);
    if (functionCalls.length === 0) {
      return getText(content) || response.text || "Could not generate a response right now.";
    }

    history.push(content);

    const toolResults = await Promise.all(
      functionCalls.map(async (call) => ({
        functionResponse: {
          name: call.name ?? "unknown_tool",
          response: await executeTool(context, call),
        },
      }))
    );

    history.push({
      role: "tool",
      parts: toolResults,
    });

    finalText = response.text ?? finalText;
  }

  return finalText || "I could not finish the request in time.";
};
