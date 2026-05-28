"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDiscordInteractions = void 0;
const discord_1 = require("../discord");
const stravaStats_1 = require("../stravaStats");
const stravaClubActivitiesMessage_1 = require("../stravaClubActivitiesMessage");
const requestUtils_1 = require("../requestUtils");
const http_1 = require("../http");
const stravaApi_1 = require("../stravaApi");
const DEFAULT_CLUB_ID = "1600752";
const handleDiscordInteractions = async (event) => {
    const rawBody = (0, requestUtils_1.getRawBody)(event);
    if (!(0, discord_1.isValidDiscordRequest)(event, rawBody)) {
        return {
            statusCode: 401,
            body: "Invalid request signature",
        };
    }
    const body = JSON.parse(rawBody || "{}");
    const helpMessage = [
        "**Available commands**",
        "`/health` - Check bot health",
        "`/strava` - Connect your Strava account",
        "`/stats` - Show your weekly Strava stats",
        "`/club-activities` - List recent activities from a Strava club",
        "`/help` - Show this message",
    ].join("\n");
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
    if (body.data?.name === "help") {
        return (0, http_1.jsonResponse)(200, {
            type: 4,
            data: {
                content: helpMessage,
                // flags: 64,
            },
        });
    }
    if (body.data?.name === "stats") {
        const discordUserId = body.member?.user?.id ?? body.user?.id;
        if (!discordUserId) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not identify your Discord user.",
                    // flags: 64,
                },
            });
        }
        const user = await (0, stravaApi_1.getLinkedStravaUserByDiscordId)(discordUserId);
        if (!user) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "No Strava account is linked yet. Run `/strava` first.",
                    // flags: 64,
                },
            });
        }
        try {
            const afterUnixSeconds = (0, stravaStats_1.getCurrentWeekStartUnixSeconds)();
            const activities = await (0, stravaApi_1.fetchStravaActivitiesSince)(user, afterUnixSeconds);
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: (0, stravaStats_1.buildWeeklyStatsMessage)(activities),
                    // flags: 64,
                },
            });
        }
        catch (error) {
            console.error("Failed to fetch weekly Strava stats", {
                discordUserId,
                error,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not load your weekly Strava stats right now.",
                    // flags: 64,
                },
            });
        }
    }
    if (body.data?.name === "club-activities") {
        const discordUserId = body.member?.user?.id ?? body.user?.id;
        if (!discordUserId) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not identify your Discord user.",
                    // flags: 64,
                },
            });
        }
        const user = await (0, stravaApi_1.getLinkedStravaUserByDiscordId)(discordUserId);
        if (!user) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "No Strava account is linked yet. Run `/strava` first.",
                    // flags: 64,
                },
            });
        }
        try {
            const club = await (0, stravaApi_1.getClubById)(user, DEFAULT_CLUB_ID);
            const activities = await (0, stravaApi_1.getClubActivitiesById)(user, DEFAULT_CLUB_ID, 1, 30);
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: (0, stravaClubActivitiesMessage_1.buildClubActivitiesMessageForClub)(activities, club.name ?? "", DEFAULT_CLUB_ID),
                    // flags: 64,
                },
            });
        }
        catch (error) {
            console.error("Failed to fetch club activities", {
                discordUserId,
                clubId: DEFAULT_CLUB_ID,
                error,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not load club activities right now.",
                    // flags: 64,
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
