"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildWeeklyStatsMessage = exports.calculateWeeklyStats = exports.getCurrentWeekStartUnixSeconds = void 0;
const MANILA_UTC_OFFSET_MINUTES = 8 * 60;
const formatDistanceKm = (meters) => {
    const kilometers = meters / 1000;
    return `${kilometers.toFixed(1)} km`;
};
const formatCompactDistanceKm = (meters) => {
    const kilometers = meters / 1000;
    const rounded = Number.isInteger(kilometers) ? kilometers.toFixed(0) : kilometers.toFixed(1);
    return `${rounded}km`;
};
const formatPacePerKm = (movingTimeSeconds, distanceMeters) => {
    if (movingTimeSeconds <= 0 || distanceMeters <= 0) {
        return "n/a";
    }
    const secondsPerKm = movingTimeSeconds / (distanceMeters / 1000);
    const minutes = Math.floor(secondsPerKm / 60);
    const seconds = Math.round(secondsPerKm % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
};
const formatTotalTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
};
const getCurrentWeekStartUnixSeconds = () => {
    const offsetMs = MANILA_UTC_OFFSET_MINUTES * 60 * 1000;
    const localNow = new Date(Date.now() + offsetMs);
    const localDay = localNow.getUTCDay();
    const daysSinceMonday = (localDay + 6) % 7;
    const localMidnightMs = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
    const weekStartLocalMs = localMidnightMs - daysSinceMonday * 24 * 60 * 60 * 1000;
    return Math.floor((weekStartLocalMs - offsetMs) / 1000);
};
exports.getCurrentWeekStartUnixSeconds = getCurrentWeekStartUnixSeconds;
const isRunningActivity = (activity) => {
    const labels = [activity.type, activity.sport_type].filter((label) => typeof label === "string");
    return labels.some((label) => /run/i.test(label));
};
const isWithinCurrentWeek = (activity) => {
    if (!activity.start_date) {
        return false;
    }
    const startedAt = new Date(activity.start_date).getTime();
    if (Number.isNaN(startedAt)) {
        return false;
    }
    const weekStart = (0, exports.getCurrentWeekStartUnixSeconds)() * 1000;
    return startedAt >= weekStart;
};
const calculateWeeklyStats = (activities) => {
    return activities
        .filter(isWithinCurrentWeek)
        .reduce((stats, activity) => {
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
    }, {
        distanceMeters: 0,
        runCount: 0,
        movingTimeSeconds: 0,
        elapsedTimeSeconds: 0,
        longestRunMeters: 0,
    });
};
exports.calculateWeeklyStats = calculateWeeklyStats;
const buildWeeklyStatsMessage = (activities) => {
    const stats = (0, exports.calculateWeeklyStats)(activities);
    return [
        "🏃 Weekly Stats",
        `Distance: ${formatDistanceKm(stats.distanceMeters)}`,
        `Runs: ${stats.runCount}`,
        `Average Pace: ${formatPacePerKm(stats.movingTimeSeconds, stats.distanceMeters)}`,
        `Longest Run: ${stats.longestRunMeters > 0 ? formatCompactDistanceKm(stats.longestRunMeters) : "n/a"}`,
        `Total Time: ${formatTotalTime(stats.elapsedTimeSeconds)}`,
    ].join("\n");
};
exports.buildWeeklyStatsMessage = buildWeeklyStatsMessage;
