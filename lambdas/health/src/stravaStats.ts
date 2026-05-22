import { StravaActivity } from "./stravaApi";

const MANILA_UTC_OFFSET_MINUTES = 8 * 60;

type WeeklyStats = {
  distanceMeters: number;
  runCount: number;
  movingTimeSeconds: number;
  elapsedTimeSeconds: number;
  longestRunMeters: number;
};

const formatDistanceKm = (meters: number) => {
  const kilometers = meters / 1000;

  return `${kilometers.toFixed(1)} km`;
};

const formatCompactDistanceKm = (meters: number) => {
  const kilometers = meters / 1000;
  const rounded = Number.isInteger(kilometers) ? kilometers.toFixed(0) : kilometers.toFixed(1);

  return `${rounded}km`;
};

const formatPacePerKm = (movingTimeSeconds: number, distanceMeters: number) => {
  if (movingTimeSeconds <= 0 || distanceMeters <= 0) {
    return "n/a";
  }

  const secondsPerKm = movingTimeSeconds / (distanceMeters / 1000);
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);

  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
};

const formatTotalTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${hours}h ${minutes}m`;
};

export const getCurrentWeekStartUnixSeconds = () => {
  const offsetMs = MANILA_UTC_OFFSET_MINUTES * 60 * 1000;
  const localNow = new Date(Date.now() + offsetMs);
  const localDay = localNow.getUTCDay();
  const daysSinceMonday = (localDay + 6) % 7;
  const localMidnightMs = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate()
  );
  const weekStartLocalMs = localMidnightMs - daysSinceMonday * 24 * 60 * 60 * 1000;

  return Math.floor((weekStartLocalMs - offsetMs) / 1000);
};

const isRunningActivity = (activity: StravaActivity) => {
  const labels = [activity.type, activity.sport_type].filter(
    (label): label is string => typeof label === "string"
  );
  return labels.some((label) => /run/i.test(label));
};

const isWithinCurrentWeek = (activity: StravaActivity) => {
  if (!activity.start_date) {
    return false;
  }

  const startedAt = new Date(activity.start_date).getTime();
  if (Number.isNaN(startedAt)) {
    return false;
  }

  const weekStart = getCurrentWeekStartUnixSeconds() * 1000;
  return startedAt >= weekStart;
};

export const calculateWeeklyStats = (activities: StravaActivity[]): WeeklyStats => {
  return activities
    .filter(isWithinCurrentWeek)
    .reduce<WeeklyStats>(
      (stats, activity) => {
        if (!isRunningActivity(activity)) {
          return stats;
        }

        const distanceMeters = activity.distance ?? 0;
        const movingTimeSeconds = activity.moving_time ?? 0;
        const elapsedTimeSeconds = activity.elapsed_time ?? 0;

        return {
          distanceMeters: stats.distanceMeters + distanceMeters,
          runCount: stats.runCount + 1,
          movingTimeSeconds: stats.movingTimeSeconds + movingTimeSeconds,
          elapsedTimeSeconds: stats.elapsedTimeSeconds + elapsedTimeSeconds,
          longestRunMeters: Math.max(stats.longestRunMeters, distanceMeters),
        };
      },
      {
        distanceMeters: 0,
        runCount: 0,
        movingTimeSeconds: 0,
        elapsedTimeSeconds: 0,
        longestRunMeters: 0,
      }
  );
};

export const buildWeeklyStatsMessage = (activities: StravaActivity[]) => {
  const stats = calculateWeeklyStats(activities);

  return [
    "🏃 Weekly Stats",
    `Distance: ${formatDistanceKm(stats.distanceMeters)}`,
    `Runs: ${stats.runCount}`,
    `Average Pace: ${formatPacePerKm(stats.movingTimeSeconds, stats.distanceMeters)}`,
    `Longest Run: ${stats.longestRunMeters > 0 ? formatCompactDistanceKm(stats.longestRunMeters) : "n/a"}`,
    `Total Time: ${formatTotalTime(stats.elapsedTimeSeconds)}`,
  ].join("\n");
};
