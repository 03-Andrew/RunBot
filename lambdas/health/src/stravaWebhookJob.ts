export type StravaWebhookJob = {
  kind: "strava-webhook";
  ownerId: number;
  activityId: number;
  objectType: string;
  aspectType: string;
};

export const isStravaWebhookJob = (value: unknown): value is StravaWebhookJob => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as Partial<StravaWebhookJob>;

  return (
    (job.kind === undefined || job.kind === "strava-webhook") &&
    typeof job.ownerId === "number" &&
    Number.isFinite(job.ownerId) &&
    typeof job.activityId === "number" &&
    Number.isFinite(job.activityId) &&
    typeof job.objectType === "string" &&
    typeof job.aspectType === "string"
  );
};
