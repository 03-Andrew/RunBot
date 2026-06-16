import {
  getStoredPersonalRecordsByDiscordId,
  type StravaActivity,
} from "../stravaApi";
import { calculateWeeklyStats } from "../stravaFormatting";
import type { AgentContext, RunComparisonSummary, ToolCall, ToolDefinition, WeeklyStatsSummary } from "./types";
import {
  DEFAULT_BASELINE_COUNT,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_RECENT_LIMIT,
  dedupeAndSortRuns,
  formatPaceForStruct,
  getOrFetchActivities,
  loadRunHistory,
  MAX_BASELINE_COUNT,
  MAX_LOOKBACK_DAYS,
  MAX_RECENT_LIMIT,
  PR_5K_THRESHOLD_M,
  PR_10K_THRESHOLD_M,
  PR_HALF_MARATHON_THRESHOLD_M,
  summarizeRun,
  summarizeRuns,
} from "./run-data";

// ── Tool implementations ──────────────────────────────────────────

const getLatestRun = async (context: AgentContext) =>
  getRecentRuns(context, { limit: DEFAULT_RECENT_LIMIT, lookbackDays: DEFAULT_LOOKBACK_DAYS });

const getRecentRuns = async (
  context: AgentContext,
  args: Record<string, unknown>
) => {
  if (!context.linkedStravaUser) {
    return { error: "No linked Strava account is available for this user." };
  }

  const limit = Number(args.limit);
  const lookbackDays = Number(args.lookbackDays);
  const runLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), MAX_RECENT_LIMIT) : DEFAULT_RECENT_LIMIT;
  const safeLookbackDays =
    Number.isFinite(lookbackDays) && lookbackDays > 0
      ? Math.min(Math.floor(lookbackDays), MAX_LOOKBACK_DAYS)
      : DEFAULT_LOOKBACK_DAYS;

  const runs = await loadRunHistory(context, safeLookbackDays);

  return {
    latestRun: runs[0] ? summarizeRun(runs[0]) : undefined,
    recentRuns: summarizeRuns(runs.slice(0, runLimit)),
    note: runs.length === 0 ? "No running activity was found in the lookback window." : undefined,
  };
};

const getWeeklyStats = async (context: AgentContext): Promise<{ weeklyStats?: WeeklyStatsSummary; error?: string }> => {
  if (!context.linkedStravaUser) {
    return { error: "No linked Strava account is available for this user." };
  }

  const activities = await getOrFetchActivities(context);
  const stats = calculateWeeklyStats(activities);

  return {
    weeklyStats: {
      distanceKm: stats.distanceMeters / 1000,
      runCount: stats.runCount,
      movingTimeSeconds: stats.movingTimeSeconds,
      elapsedTimeSeconds: stats.elapsedTimeSeconds,
      longestRunKm: stats.longestRunMeters / 1000,
      averagePacePerKm: formatPaceForStruct(stats.movingTimeSeconds, stats.distanceMeters) ?? "n/a",
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
      ? Math.min(Math.floor(lookbackDays), MAX_LOOKBACK_DAYS)
      : DEFAULT_LOOKBACK_DAYS;
  const safeBaselineCount =
    Number.isFinite(baselineRunCount) && baselineRunCount > 0
      ? Math.min(Math.floor(baselineRunCount), MAX_BASELINE_COUNT)
      : DEFAULT_BASELINE_COUNT;

  const runs = await loadRunHistory(context, safeLookbackDays);
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
      latestPacePerKm: formatPaceForStruct(latestRun.moving_time, latestRun.distance),
      baselineAveragePacePerKm:
        paceAverage != null ? formatPaceForStruct(paceAverage, 1000) : undefined,
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

  console.log(`Materialized PR record not found. Falling back to on-the-fly calculations for user ${context.discordUserId}`);
  const activities = await getOrFetchActivities(context);
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

      if (distM >= PR_5K_THRESHOLD_M && paceSecondsPerKm < best5kPaceSeconds) {
        best5kPaceSeconds = paceSecondsPerKm;
        best5k = run;
      }

      if (distM >= PR_10K_THRESHOLD_M && paceSecondsPerKm < best10kPaceSeconds) {
        best10kPaceSeconds = paceSecondsPerKm;
        best10k = run;
      }

      if (distM >= PR_HALF_MARATHON_THRESHOLD_M && paceSecondsPerKm < bestHalfPaceSeconds) {
        bestHalfPaceSeconds = paceSecondsPerKm;
        bestHalf = run;
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

// ── Tool definitions & dispatch ───────────────────────────────────

const TOOL_MAP = {
  get_personal_records: getPersonalRecords,
  get_latest_run: getLatestRun,
  get_recent_runs: getRecentRuns,
  get_weekly_stats: getWeeklyStats,
  compare_to_past_runs: compareToPastRuns,
} as const;

type ToolName = keyof typeof TOOL_MAP;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function" as const,
    function: {
      name: "get_personal_records",
      description:
        "Get the user's all-time running personal records (PRs) computed from database history, including longest run, biggest climb, and fastest 5k/10k/Half Marathon.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_latest_run",
      description:
        "Get the user's most recent running activity and a small recent-run sample for context.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recent_runs",
      description:
        "Get a list of recent running activities for comparison, pacing, and trend analysis.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum number of runs to return. Clamp this to a small number." },
          lookbackDays: { type: "number", description: "How far back to search for running activities, in days." },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_weekly_stats",
      description:
        "Get the user's weekly running volume, count, total time, longest run, and average pace.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_to_past_runs",
      description:
        "Compare the user's latest run with a baseline of prior runs to estimate whether it was faster, slower, easier, or heavier than usual.",
      parameters: {
        type: "object",
        properties: {
          baselineRunCount: { type: "number", description: "How many prior runs to use as the comparison baseline." },
          lookbackDays: { type: "number", description: "How far back to search for runs before building the baseline, in days." },
        },
        required: [],
      },
    },
  },
];

export const executeTool = async (context: AgentContext, call: ToolCall) => {
  const name = call.function.name as ToolName | undefined;
  const handler = name ? TOOL_MAP[name] : undefined;
  if (!handler) return { error: `Unknown tool: ${call.function.name}` };
  const args = call.function.arguments ? JSON.parse(call.function.arguments) as Record<string, unknown> : {};
  return { result: await handler(context, args) };
};
