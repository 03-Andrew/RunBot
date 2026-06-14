import {
  getStoredStravaActivitiesByDiscordId,
  type StravaActivity,
} from "../stravaApi";
import {
  formatDuration,
  formatPacePerKmWithSpace,
  getActivityTimestamp,
  isRunningActivity,
} from "../stravaFormatting";
import type { AgentContext, RunSummary } from "./types";

export const DEFAULT_LOOKBACK_DAYS = 90;
export const DEFAULT_RECENT_LIMIT = 5;
export const DEFAULT_BASELINE_COUNT = 5;
export const MAX_RECENT_LIMIT = 15;
export const MAX_BASELINE_COUNT = 20;
export const MAX_LOOKBACK_DAYS = 365;
export const PR_5K_THRESHOLD_M = 4900;
export const PR_10K_THRESHOLD_M = 9900;
export const PR_HALF_MARATHON_THRESHOLD_M = 20900;

export const formatPaceForStruct = (movingTimeSeconds?: number, distanceMeters?: number) => {
  const result = formatPacePerKmWithSpace(movingTimeSeconds, distanceMeters);
  return result === "n/a" ? undefined : result;
};

export const formatDurationForStruct = (seconds?: number) => {
  const result = formatDuration(seconds);
  return result === "n/a" ? undefined : result;
};

export const summarizeRun = (run: StravaActivity): RunSummary => ({
  id: run.id,
  name: run.name,
  startDate: run.start_date,
  type: run.type,
  sportType: run.sport_type,
  distanceKm: run.distance != null ? run.distance / 1000 : undefined,
  movingTimeSeconds: run.moving_time,
  elapsedTimeSeconds: run.elapsed_time,
  pacePerKm: formatPaceForStruct(run.moving_time, run.distance),
  duration: formatDurationForStruct(run.moving_time),
  prCount: run.pr_count,
  totalElevationGain: run.total_elevation_gain,
});

export const summarizeRuns = (runs: StravaActivity[]) => runs.map(summarizeRun);

export const dedupeAndSortRuns = (activities: StravaActivity[]) => {
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

export const getOrFetchActivities = async (context: AgentContext) => {
  if (context.cachedActivities) return context.cachedActivities;
  const activities = await getStoredStravaActivitiesByDiscordId(context.discordUserId);
  context.cachedActivities = activities;
  return activities;
};

export const loadRunHistory = async (
  context: AgentContext,
  lookbackDays: number
) => {
  const activities = await getOrFetchActivities(context);
  const runs = dedupeAndSortRuns(activities);

  const afterUnixSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
  return runs.filter(run => {
    const ts = getActivityTimestamp(run) / 1000;
    return ts >= afterUnixSeconds;
  });
};
