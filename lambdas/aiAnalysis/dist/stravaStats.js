"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateWeeklyStats = exports.getCurrentWeekStartUnixSeconds = void 0;
const MANILA_UTC_OFFSET_MINUTES = 8 * 60;
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
