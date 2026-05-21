import { handleDiscordInteractions } from "./handlers/discordInteractions";
import { handleHealth } from "./handlers/health";
import { handleStravaCallback } from "./handlers/stravaCallback";
import { handleStravaWebhook } from "./handlers/stravaWebhook";

export const handler = async (event: any) => {
  const path = event.requestContext?.http?.path;
  const method = event.requestContext?.http?.method;

  if (path === "/health" && method === "GET") {
    return handleHealth();
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
