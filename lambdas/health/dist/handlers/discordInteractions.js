"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDiscordInteractions = void 0;
const discord_1 = require("../discord");
const stravaApi_1 = require("../stravaApi");
const stravaActivityMessage_1 = require("../stravaActivityMessage");
const requestUtils_1 = require("../requestUtils");
const http_1 = require("../http");
const handleDiscordInteractions = async (event) => {
    const rawBody = (0, requestUtils_1.getRawBody)(event);
    if (!(0, discord_1.isValidDiscordRequest)(event, rawBody)) {
        return {
            statusCode: 401,
            body: "Invalid request signature",
        };
    }
    const body = JSON.parse(rawBody || "{}");
    if (body.type === 1) {
        return (0, http_1.jsonResponse)(200, { type: 1 });
    }
    if (body.data?.name === "strava") {
        const discordUserId = body.member?.user?.id ?? body.user?.id;
        if (!discordUserId) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not identify your Discord user.",
                },
            });
        }
        const clientId = process.env.STRAVA_CLIENT_ID;
        if (!clientId) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Strava is not configured yet.",
                },
            });
        }
        return (0, http_1.jsonResponse)(200, {
            type: 4,
            data: {
                content: `Connect Strava:\n${(0, discord_1.buildStravaAuthorizeUrl)(discordUserId, clientId)}`,
            },
        });
    }
    if (body.data?.name === "get-latest") {
        const discordUserId = body.member?.user?.id ?? body.user?.id;
        if (!discordUserId) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not identify your Discord user.",
                    flags: 64,
                },
            });
        }
        const user = (await (0, stravaApi_1.getLinkedStravaUserByDiscordId)(discordUserId));
        if (!user) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "No Strava account is linked yet. Run `/strava` first.",
                    flags: 64,
                },
            });
        }
        try {
            const activity = await (0, stravaApi_1.fetchLatestStravaActivity)(user);
            if (!activity) {
                return (0, http_1.jsonResponse)(200, {
                    type: 4,
                    data: {
                        content: "No recent Strava activity found.",
                        flags: 64,
                    },
                });
            }
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: (0, stravaActivityMessage_1.buildStravaActivityMessage)(activity, discordUserId),
                    flags: 64,
                },
            });
        }
        catch (error) {
            console.error("Failed to fetch latest Strava activity", {
                discordUserId,
                error,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not load your latest Strava activity right now.",
                    flags: 64,
                },
            });
        }
    }
    return (0, http_1.jsonResponse)(200, {
        type: 4,
        data: {
            content: "✅ System online",
        },
    });
};
exports.handleDiscordInteractions = handleDiscordInteractions;
