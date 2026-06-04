export type ApiGatewayEvent = {
  body?: string | null;
  headers?: Record<string, string | undefined>;
  isBase64Encoded?: boolean;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
  };
};

export type DiscordSlashCommandJob = {
  kind: "discord-slash-command";
  commandName: "stats" | "club-activities" | "analyse-run" | "ai-chat";
  interactionToken: string;
  discordUserId: string;
  prompt?: string;
};

export const isDiscordSlashCommandJob = (
  value: unknown
): value is DiscordSlashCommandJob => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as Partial<DiscordSlashCommandJob>;

  return (
    job.kind === "discord-slash-command" &&
    (job.commandName === "stats" ||
      job.commandName === "club-activities" ||
      job.commandName === "analyse-run" ||
      job.commandName === "ai-chat") &&
    typeof job.interactionToken === "string" &&
    job.interactionToken.length > 0 &&
    typeof job.discordUserId === "string" &&
    job.discordUserId.length > 0
  );
};

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

export type StravaBackfillJob = {
  kind: "strava-backfill";
  discordUserId: string;
  lookbackDays?: number;
};

export const isStravaBackfillJob = (value: unknown): value is StravaBackfillJob => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as Partial<StravaBackfillJob>;

  return (
    job.kind === "strava-backfill" &&
    typeof job.discordUserId === "string" &&
    job.discordUserId.length > 0
  );
};

