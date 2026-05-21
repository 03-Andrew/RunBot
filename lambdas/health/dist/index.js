"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const discordInteractions_1 = require("./handlers/discordInteractions");
const health_1 = require("./handlers/health");
const stravaCallback_1 = require("./handlers/stravaCallback");
const stravaWebhook_1 = require("./handlers/stravaWebhook");
const handler = async (event) => {
    const path = event.requestContext?.http?.path;
    const method = event.requestContext?.http?.method;
    if (path === "/health" && method === "GET") {
        return (0, health_1.handleHealth)();
    }
    if (path === "/strava/callback" && method === "GET") {
        return (0, stravaCallback_1.handleStravaCallback)(event);
    }
    if (path === "/strava/webhook") {
        return (0, stravaWebhook_1.handleStravaWebhook)(event);
    }
    if (path === "/discord-interactions" && method === "POST") {
        return (0, discordInteractions_1.handleDiscordInteractions)(event);
    }
    return {
        statusCode: 404,
        body: "Not Found",
    };
};
exports.handler = handler;
