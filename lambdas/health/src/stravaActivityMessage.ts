import { StravaActivity } from "./stravaApi";

const formatDuration = (seconds?: number) => {
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

const formatDistanceKm = (meters?: number) => {
  if (meters == null || Number.isNaN(meters)) {
    return "n/a";
  }

  const kilometers = meters / 1000;
  return `${kilometers.toFixed(kilometers >= 10 ? 1 : 2)} km`;
};

const formatPacePerKm = (movingTime?: number, distanceMeters?: number) => {
  if (!movingTime || !distanceMeters || distanceMeters <= 0) {
    return "n/a";
  }

  const secondsPerKm = movingTime / (distanceMeters / 1000);
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);

  return `${minutes}:${String(seconds).padStart(2, "0")} /km`;
};

export const buildStravaActivityMessage = (activity: StravaActivity, discordUserId: string) => {
  const prCount = activity.pr_count ?? 0;

  return [
    `🏃 Activity detected for <@${discordUserId}>`,
    activity.name ? `**${activity.name}**` : undefined,
    `Distance: ${formatDistanceKm(activity.distance)}`,
    `Pace: ${formatPacePerKm(activity.moving_time, activity.distance)}`,
    `Elapsed: ${formatDuration(activity.elapsed_time)}`,
    `PRs: ${prCount}`,
  ]
    .filter(Boolean)
    .join("\n");
};
