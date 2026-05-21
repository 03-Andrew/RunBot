"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStravaCallback = void 0;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const storage_1 = require("../storage");
const http_1 = require("../http");
const stravaConnectedPage_1 = require("../stravaConnectedPage");
const handleStravaCallback = async (event) => {
    const code = event.queryStringParameters?.code;
    const discordId = event.queryStringParameters?.state;
    if (!code || !discordId) {
        return (0, http_1.textResponse)(400, "Missing Strava authorization code or state.");
    }
    if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
        return (0, http_1.textResponse)(500, "Strava is not configured.");
    }
    const response = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
        }),
    });
    const data = await response.json();
    if (!response.ok || !data.athlete?.id) {
        console.error("Strava token exchange failed", {
            status: response.status,
            message: data.message,
            errors: data.errors,
        });
        return (0, http_1.textResponse)(400, "Could not connect Strava. Please try /strava again.");
    }
    const athleteId = data.athlete.id;
    await storage_1.db.send(new lib_dynamodb_1.PutCommand({
        TableName: "ActivityBot",
        Item: {
            PK: `USER#${discordId}`,
            SK: "PROFILE",
            DiscordID: discordId,
            StravaID: athleteId,
            AccessToken: data.access_token,
            RefreshToken: data.refresh_token,
            ExpiresAt: data.expires_at,
            GSI1PK: `STRAVA#${athleteId}`,
            GSI1SK: "PROFILE",
        },
    }));
    return (0, http_1.htmlResponse)(200, stravaConnectedPage_1.stravaConnectedPage);
};
exports.handleStravaCallback = handleStravaCallback;
