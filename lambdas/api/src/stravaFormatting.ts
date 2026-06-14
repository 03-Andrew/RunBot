import { StravaActivity, ClubActivity } from "./stravaApi";

const MANILA_UTC_OFFSET_MINUTES = 8 * 60;

type WeeklyStats = {
  distanceMeters: number;
  runCount: number;
  movingTimeSeconds: number;
  elapsedTimeSeconds: number;
  longestRunMeters: number;
};

export const formatDistanceKm = (meters?: number) => {
  if (meters == null || Number.isNaN(meters)) {
    return "n/a";
  }
  return `${(meters / 1000).toFixed(1)} km`;
};

export const formatDistanceKmWith2Decimals = (meters?: number) => {
  if (meters == null || Number.isNaN(meters)) {
    return "n/a";
  }

  const kilometers = meters / 1000;
  return `${kilometers.toFixed(kilometers >= 10 ? 1 : 2)} km`;
};

export const formatCompactDistanceKm = (meters: number) => {
  const kilometers = meters / 1000;
  const rounded = Number.isInteger(kilometers) ? kilometers.toFixed(0) : kilometers.toFixed(1);

  return `${rounded}km`;
};

export const formatPacePerKm = (movingTimeSeconds: number, distanceMeters: number) => {
  if (movingTimeSeconds <= 0 || distanceMeters <= 0) {
    return "n/a";
  }

  const secondsPerKm = Math.round(movingTimeSeconds / (distanceMeters / 1000));
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
};

export const formatPacePerKmWithSpace = (movingTime?: number, distanceMeters?: number) => {
  if (!movingTime || !distanceMeters || distanceMeters <= 0) {
    return "n/a";
  }

  const secondsPerKm = Math.round(movingTime / (distanceMeters / 1000));
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")} /km`;
};

export const formatTotalTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  return `${hours}h ${minutes}m`;
};

export const formatDuration = (seconds?: number) => {
  if (seconds == null || Number.isNaN(seconds)) {
    return "n/a";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};

const getAthleteName = (athlete?: ClubActivity["athlete"]) => {
  const firstName = athlete?.firstname?.trim();
  const lastName = athlete?.lastname?.trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return fullName || "Unknown athlete";
};

const getActivityType = (activity: ClubActivity) => activity.sport_type ?? activity.type ?? "Activity";

export const buildStravaActivityMessage = (activity: StravaActivity, discordUserId: string) => {
  const prCount = activity.pr_count ?? 0;

  return [
    `🏃 Activity detected for <@${discordUserId}>`,
    activity.name ? `**${activity.name}**` : undefined,
    `Distance: ${formatDistanceKmWith2Decimals(activity.distance)}`,
    `Pace: ${formatPacePerKmWithSpace(activity.moving_time, activity.distance)}`,
    `Elapsed: ${formatDuration(activity.elapsed_time)}`,
    `PRs: ${prCount}`,
  ]
    .filter(Boolean)
    .join("\n");
};

export const buildClubActivitiesMessage = (activities: ClubActivity[], clubId: string) => {
  if (activities.length === 0) {
    return [`Club activities for ${clubId}`, "No recent activities found."].join("\n");
  }

  return [
    `Club activities for ${clubId}`,
    ...activities.slice(0, 10).map((activity, index) => {
      const athleteName = getAthleteName(activity.athlete);
      const activityType = getActivityType(activity);
      const activityName = activity.name ? ` - ${activity.name}` : "";

      return `${index + 1}. ${athleteName}: ${activityType}${activityName} (${formatDistanceKm(
        activity.distance
      )}, ${formatDuration(activity.moving_time ?? activity.elapsed_time)})`;
    }),
  ].join("\n");
};

export const buildClubActivitiesMessageForClub = (
  activities: ClubActivity[],
  clubName: string,
  clubId: string
) => {
  const heading = clubName.trim().length > 0 ? `Club activities for ${clubName}` : `Club activities for ${clubId}`;

  if (activities.length === 0) {
    return [heading, "No recent activities found."].join("\n");
  }

  return [
    heading,
    ...activities.slice(0, 10).map((activity, index) => {
      const athleteName = getAthleteName(activity.athlete);
      const activityType = getActivityType(activity);
      const activityName = activity.name ? ` - ${activity.name}` : "";

      return `${index + 1}. ${athleteName}: ${activityType}${activityName} (${formatDistanceKm(
        activity.distance
      )}, ${formatDuration(activity.moving_time ?? activity.elapsed_time)})`;
    }),
  ].join("\n");
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

export const isRunningActivity = (activity: StravaActivity) => {
  const labels = [activity.type, activity.sport_type].filter(
    (label): label is string => typeof label === "string"
  );
  return labels.some((label) => /run/i.test(label));
};

export const getActivityTimestamp = (activity: StravaActivity) => {
  if (!activity.start_date) return 0;
  const ts = new Date(activity.start_date).getTime();
  return Number.isNaN(ts) ? 0 : ts;
};

const isWithinCurrentWeek = (activity: StravaActivity) => {
  const ts = getActivityTimestamp(activity);
  if (ts === 0) return false;
  const weekStart = getCurrentWeekStartUnixSeconds() * 1000;
  return ts >= weekStart;
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
