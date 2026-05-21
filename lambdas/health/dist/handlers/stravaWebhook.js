"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStravaWebhook = void 0;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const storage_1 = require("../storage");
const http_1 = require("../http");
const requestUtils_1 = require("../requestUtils");
const stravaActivityMessage_1 = require("../stravaActivityMessage");
const stravaApi_1 = require("../stravaApi");
const handleStravaWebhook = async (event) => {
    if (event.requestContext?.http?.method === "GET") {
        const challenge = event.queryStringParameters?.["hub.challenge"];
        const verifyToken = event.queryStringParameters?.["hub.verify_token"];
        if (verifyToken !== process.env.VERIFY_TOKEN) {
            return (0, http_1.textResponse)(403, "Invalid token");
        }
        return (0, http_1.jsonResponse)(200, { "hub.challenge": challenge });
    }
    const rawBody = (0, requestUtils_1.getRawBody)(event);
    const body = JSON.parse(rawBody || "{}");
    const owner = body.owner_id;
    const activityId = Number(body.object_id);
    const objectType = body.object_type;
    const aspectType = body.aspect_type;
    console.log("incoming webhook");
    console.log(JSON.stringify(body));
    if (!owner) {
        console.log("Ignoring Strava webhook without owner_id");
        return (0, http_1.jsonResponse)(200, {
            ignored: true,
            reason: "missing_owner_id",
        });
    }
    if (objectType !== "activity" || !["create", "update"].includes(aspectType)) {
        console.log("Ignoring non-notifiable Strava webhook", {
            objectType,
            aspectType,
        });
        return (0, http_1.jsonResponse)(200, {
            ignored: true,
            reason: "not_notifiable",
        });
    }
    if (!activityId) {
        console.log("Ignoring Strava webhook without object_id");
        return (0, http_1.jsonResponse)(200, {
            ignored: true,
            reason: "missing_object_id",
        });
    }
    console.log("Looking up linked Discord user", {
        gsi1pk: `STRAVA#${owner}`,
    });
    const result = await storage_1.db.send(new lib_dynamodb_1.QueryCommand({
        TableName: "ActivityBot",
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK=:pk",
        ExpressionAttributeValues: {
            ":pk": `STRAVA#${owner}`,
        },
    }));
    const user = result.Items?.[0];
    if (!user) {
        console.log("No user found");
        return (0, http_1.jsonResponse)(200, {
            ignored: true,
        });
    }
    console.log("Found Discord user:", user.DiscordID);
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CHANNEL_ID) {
        console.error("Discord notification is not configured", {
            hasBotToken: Boolean(process.env.DISCORD_BOT_TOKEN),
            hasChannelId: Boolean(process.env.DISCORD_CHANNEL_ID),
        });
        return (0, http_1.jsonResponse)(200, {
            received: true,
            discordId: user.DiscordID,
            notified: false,
            reason: "discord_not_configured",
        });
    }
    const typedUser = user;
    let activity;
    try {
        activity = await (0, stravaApi_1.fetchStravaActivity)(typedUser, activityId);
    }
    catch (error) {
        console.error("Failed to fetch Strava activity", {
            activityId,
            error,
        });
        return (0, http_1.jsonResponse)(200, {
            received: true,
            discordId: user.DiscordID,
            notified: false,
            reason: "activity_fetch_failed",
        });
    }
    const discordResponse = await fetch(`https://discord.com/api/v10/channels/${process.env.DISCORD_CHANNEL_ID}/messages`, {
        method: "POST",
        headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            content: (0, stravaActivityMessage_1.buildStravaActivityMessage)(activity, user.DiscordID),
        }),
    });
    console.log("Discord API response", discordResponse);
    if (!discordResponse.ok) {
        const errorBody = await discordResponse.text();
        console.error("Discord message failed", {
            status: discordResponse.status,
            body: errorBody,
        });
        return (0, http_1.jsonResponse)(200, {
            received: true,
            discordId: user.DiscordID,
            notified: false,
            discordStatus: discordResponse.status,
        });
    }
    console.log("Discord message sent");
    return (0, http_1.jsonResponse)(200, {
        received: true,
        discordId: user.DiscordID,
        notified: true,
    });
};
exports.handleStravaWebhook = handleStravaWebhook;
