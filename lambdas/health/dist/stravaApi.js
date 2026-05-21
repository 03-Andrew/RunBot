"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchLatestStravaActivity = exports.fetchStravaActivity = exports.getLinkedStravaUserByDiscordId = exports.getStravaAccessToken = void 0;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const storage_1 = require("./storage");
const STRAVA_API_BASE = "https://www.strava.com/api/v3";
const isTokenExpiringSoon = (expiresAt) => {
    if (!expiresAt) {
        return true;
    }
    return expiresAt <= Math.floor(Date.now() / 1000) + 3600;
};
const persistStravaTokens = async (user, tokenResponse) => {
    await storage_1.db.send(new lib_dynamodb_1.UpdateCommand({
        TableName: "ActivityBot",
        Key: {
            PK: user.PK,
            SK: user.SK,
        },
        UpdateExpression: "SET AccessToken = :accessToken, RefreshToken = :refreshToken, ExpiresAt = :expiresAt",
        ExpressionAttributeValues: {
            ":accessToken": tokenResponse.access_token,
            ":refreshToken": tokenResponse.refresh_token,
            ":expiresAt": tokenResponse.expires_at,
        },
    }));
};
const refreshStravaTokens = async (user) => {
    if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
        throw new Error("Strava is not configured.");
    }
    if (!user.RefreshToken) {
        throw new Error("Missing Strava refresh token.");
    }
    const response = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            client_id: process.env.STRAVA_CLIENT_ID,
            client_secret: process.env.STRAVA_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: user.RefreshToken,
        }),
    });
    const data = (await response.json());
    if (!response.ok || !data.access_token || !data.refresh_token || !data.expires_at) {
        throw new Error("Failed to refresh Strava token.");
    }
    const tokenResponse = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
    };
    await persistStravaTokens(user, tokenResponse);
    return tokenResponse;
};
const getStravaAccessToken = async (user) => {
    if (user.AccessToken && !isTokenExpiringSoon(user.ExpiresAt)) {
        return user.AccessToken;
    }
    const tokenResponse = await refreshStravaTokens(user);
    return tokenResponse.access_token;
};
exports.getStravaAccessToken = getStravaAccessToken;
const getLinkedStravaUserByDiscordId = async (discordUserId) => {
    const result = await storage_1.db.send(new lib_dynamodb_1.GetCommand({
        TableName: "ActivityBot",
        Key: {
            PK: `USER#${discordUserId}`,
            SK: "PROFILE",
        },
    }));
    return result.Item;
};
exports.getLinkedStravaUserByDiscordId = getLinkedStravaUserByDiscordId;
const fetchStravaActivity = async (user, activityId) => {
    const accessToken = await (0, exports.getStravaAccessToken)(user);
    const fetchActivity = async (token) => {
        const response = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        return response;
    };
    let response = await fetchActivity(accessToken);
    if (response.status === 401) {
        const refreshed = await refreshStravaTokens(user);
        response = await fetchActivity(refreshed.access_token);
    }
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to fetch Strava activity: ${response.status} ${errorBody}`);
    }
    return (await response.json());
};
exports.fetchStravaActivity = fetchStravaActivity;
const fetchLatestStravaActivity = async (user) => {
    const accessToken = await (0, exports.getStravaAccessToken)(user);
    const fetchActivities = async (token) => {
        const response = await fetch(`${STRAVA_API_BASE}/athlete/activities?per_page=1&page=1`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        return response;
    };
    let response = await fetchActivities(accessToken);
    if (response.status === 401) {
        const refreshed = await refreshStravaTokens(user);
        response = await fetchActivities(refreshed.access_token);
    }
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Failed to fetch latest Strava activity: ${response.status} ${errorBody}`);
    }
    const activities = (await response.json());
    return activities[0];
};
exports.fetchLatestStravaActivity = fetchLatestStravaActivity;
