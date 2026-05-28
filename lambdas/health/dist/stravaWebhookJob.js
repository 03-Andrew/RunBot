"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStravaWebhookJob = void 0;
const isStravaWebhookJob = (value) => {
    if (!value || typeof value !== "object") {
        return false;
    }
    const job = value;
    return ((job.kind === undefined || job.kind === "strava-webhook") &&
        typeof job.ownerId === "number" &&
        Number.isFinite(job.ownerId) &&
        typeof job.activityId === "number" &&
        Number.isFinite(job.activityId) &&
        typeof job.objectType === "string" &&
        typeof job.aspectType === "string");
};
exports.isStravaWebhookJob = isStravaWebhookJob;
