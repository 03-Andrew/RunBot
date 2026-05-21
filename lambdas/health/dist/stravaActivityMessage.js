"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStravaActivityMessage = void 0;
const formatDuration = (seconds) => {
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
const formatDistanceKm = (meters) => {
    if (meters == null || Number.isNaN(meters)) {
        return "n/a";
    }
    const kilometers = meters / 1000;
    return `${kilometers.toFixed(kilometers >= 10 ? 1 : 2)} km`;
};
const formatPacePerKm = (movingTime, distanceMeters) => {
    if (!movingTime || !distanceMeters || distanceMeters <= 0) {
        return "n/a";
    }
    const secondsPerKm = movingTime / (distanceMeters / 1000);
    const minutes = Math.floor(secondsPerKm / 60);
    const seconds = Math.round(secondsPerKm % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")} /km`;
};
const buildStravaActivityMessage = (activity, discordUserId) => {
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
exports.buildStravaActivityMessage = buildStravaActivityMessage;
