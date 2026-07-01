import { handleDiscordInteractions } from "./handlers/discordInteractions";
import { handleStravaCallback } from "./handlers/stravaCallback";
import { handleStravaWebhook } from "./handlers/stravaWebhook";
import { jsonResponse } from "./http";
import { createLogger } from "./logger";

export const handler = async (event: any, context: any) => {
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }
  const traceId = context?.awsRequestId ?? event?.requestContext?.requestId ?? "unknown";
  const log = createLogger(traceId);
  const path = event.requestContext?.http?.path;
  const method = event.requestContext?.http?.method;

  if (path === "/health" && method === "GET") {
    return jsonResponse(200, { status: "ok" });
  }

  if (path === "/strava/callback" && method === "GET") {
    return handleStravaCallback(event, log);
  }
  if (path === "/strava/webhook") {
    return handleStravaWebhook(event, log);
  }
  if (path === "/discord-interactions" && method === "POST") {
    return handleDiscordInteractions(event, log);
  }
  return {
    statusCode: 404,
    body: "Not Found",
  };
};
