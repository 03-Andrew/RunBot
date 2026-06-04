import { handleDiscordInteractions } from "./handlers/discordInteractions";
import { handleStravaCallback } from "./handlers/stravaCallback";
import { handleStravaWebhook } from "./handlers/stravaWebhook";
import { jsonResponse } from "./http";

export const handler = async (event: any, context: any) => {
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }
  const path = event.requestContext?.http?.path;
  const method = event.requestContext?.http?.method;

  if (path === "/health" && method === "GET") {
    return jsonResponse(200, { status: "ok" });
  }

  if (path === "/strava/callback" && method === "GET") {
    return handleStravaCallback(event);
  }
  if (path === "/strava/webhook") {
    return handleStravaWebhook(event);
  }
  if (path === "/discord-interactions" && method === "POST") {
    return handleDiscordInteractions(event);
  }
  return {
    statusCode: 404,
    body: "Not Found",
  };
};
