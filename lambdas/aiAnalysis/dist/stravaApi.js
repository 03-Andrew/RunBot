"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchStravaActivitiesSince = exports.getStoredStravaActivitiesByDiscordId = exports.getLinkedStravaUserByDiscordId = exports.getStravaAccessToken = void 0;
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
const getStoredStravaActivitiesByDiscordId = async (discordUserId) => {
    const items = [];
    let lastEvaluatedKey;
    do {
        const result = await storage_1.db.send(new lib_dynamodb_1.QueryCommand({
            TableName: "ActivityBot",
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `USER#${discordUserId}`,
                ":sk": "ACTIVITY#",
            },
            ExclusiveStartKey: lastEvaluatedKey,
        }));
        items.push(...(result.Items ?? []));
        lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    return items;
};
exports.getStoredStravaActivitiesByDiscordId = getStoredStravaActivitiesByDiscordId;
const fetchStravaActivitiesSince = async (user, afterUnixSeconds) => {
    const accessToken = await (0, exports.getStravaAccessToken)(user);
    const allActivities = [];
    const fetchPage = async (token, page) => {
        const response = await fetch(`${STRAVA_API_BASE}/athlete/activities?after=${afterUnixSeconds}&per_page=100&page=${page}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        return response;
    };
    let token = accessToken;
    for (let page = 1; page <= 10; page += 1) {
        let response = await fetchPage(token, page);
        if (response.status === 401) {
            const refreshed = await refreshStravaTokens(user);
            token = refreshed.access_token;
            response = await fetchPage(token, page);
        }
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Failed to fetch Strava activities: ${response.status} ${errorBody}`);
        }
        const activities = (await response.json());
        allActivities.push(...activities);
        if (activities.length < 100) {
            break;
        }
    }
    return allActivities;
};
exports.fetchStravaActivitiesSince = fetchStravaActivitiesSince;
