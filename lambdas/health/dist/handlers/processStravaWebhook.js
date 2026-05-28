"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleProcessStravaWebhook = void 0;
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const stravaClubActivitiesMessage_1 = require("../stravaClubActivitiesMessage");
const storage_1 = require("../storage");
const stravaActivityMessage_1 = require("../stravaActivityMessage");
const stravaApi_1 = require("../stravaApi");
const stravaWebhookJob_1 = require("../stravaWebhookJob");
const discordSlashCommandJob_1 = require("../discordSlashCommandJob");
const stravaStats_1 = require("../stravaStats");
const discordFollowup_1 = require("../discordFollowup");
const DEFAULT_CLUB_ID = "1600752";
const postDiscordMessage = async (content) => {
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CHANNEL_ID) {
        throw new Error("Discord notification is not configured.");
    }
    return fetch(`https://discord.com/api/v10/channels/${process.env.DISCORD_CHANNEL_ID}/messages`, {
        method: "POST",
        headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
    });
};
const handleWebhookJob = async (job) => {
    if (job.objectType !== "activity" || !["create", "update"].includes(job.aspectType)) {
        console.log("Ignoring non-notifiable Strava webhook job", job);
        return;
    }
    const result = await storage_1.db.send(new lib_dynamodb_1.QueryCommand({
        TableName: "ActivityBot",
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
            ":pk": `STRAVA#${job.ownerId}`,
        },
    }));
    const user = result.Items?.[0];
    if (!user) {
        console.log("No linked Discord user found for Strava owner", {
            ownerId: job.ownerId,
        });
        return;
    }
    const typedUser = user;
    const discordUserId = user.DiscordID ?? typedUser.PK.replace("USER#", "");
    const activity = await (0, stravaApi_1.fetchStravaActivity)(typedUser, job.activityId);
    await storage_1.db.send(new lib_dynamodb_1.PutCommand({
        TableName: "ActivityBot",
        Item: {
            PK: `USER#${discordUserId}`,
            SK: `ACTIVITY#${activity.id}`,
            DiscordID: discordUserId,
            UpdatedAt: new Date().toISOString(),
            ...activity,
        },
    }));
    const discordResponse = await postDiscordMessage((0, stravaActivityMessage_1.buildStravaActivityMessage)(activity, discordUserId));
    if (!discordResponse.ok) {
        const errorBody = await discordResponse.text();
        throw new Error(`Discord message failed: ${discordResponse.status} ${errorBody}`);
    }
    console.log("Discord message sent for Strava activity", {
        ownerId: job.ownerId,
        activityId: job.activityId,
    });
};
const handleDiscordSlashCommandJob = async (job) => {
    const user = await (0, stravaApi_1.getLinkedStravaUserByDiscordId)(job.discordUserId);
    if (!user) {
        const response = await (0, discordFollowup_1.postDiscordInteractionFollowUp)(job.interactionToken, "No Strava account is linked yet. Run `/strava` first.");
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Discord follow-up failed: ${response.status} ${errorBody}`);
        }
        return;
    }
    try {
        if (job.commandName === "stats") {
            const afterUnixSeconds = (0, stravaStats_1.getCurrentWeekStartUnixSeconds)();
            const activities = await (0, stravaApi_1.fetchStravaActivitiesSince)(user, afterUnixSeconds);
            const response = await (0, discordFollowup_1.postDiscordInteractionFollowUp)(job.interactionToken, (0, stravaStats_1.buildWeeklyStatsMessage)(activities));
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Discord follow-up failed: ${response.status} ${errorBody}`);
            }
            return;
        }
        const club = await (0, stravaApi_1.getClubById)(user, DEFAULT_CLUB_ID);
        const activities = await (0, stravaApi_1.getClubActivitiesById)(user, DEFAULT_CLUB_ID, 1, 30);
        const response = await (0, discordFollowup_1.postDiscordInteractionFollowUp)(job.interactionToken, (0, stravaClubActivitiesMessage_1.buildClubActivitiesMessageForClub)(activities, club.name ?? "", DEFAULT_CLUB_ID));
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Discord follow-up failed: ${response.status} ${errorBody}`);
        }
    }
    catch (error) {
        console.error("Failed to process Discord slash command", {
            commandName: job.commandName,
            discordUserId: job.discordUserId,
            error,
        });
        const response = await (0, discordFollowup_1.postDiscordInteractionFollowUp)(job.interactionToken, job.commandName === "stats"
            ? "Could not load your weekly Strava stats right now."
            : "Could not load club activities right now.");
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Discord follow-up failed: ${response.status} ${errorBody}`);
        }
    }
};
const handleProcessStravaWebhook = async (event) => {
    for (const record of event.Records ?? []) {
        let parsed;
        try {
            parsed = JSON.parse(record.body ?? "{}");
        }
        catch (error) {
            throw new Error(`Invalid SQS message body: ${String(error)}`);
        }
        if ((0, stravaWebhookJob_1.isStravaWebhookJob)(parsed)) {
            await handleWebhookJob(parsed);
            continue;
        }
        if ((0, discordSlashCommandJob_1.isDiscordSlashCommandJob)(parsed)) {
            await handleDiscordSlashCommandJob(parsed);
            continue;
        }
        throw new Error("Invalid queue job");
    }
};
exports.handleProcessStravaWebhook = handleProcessStravaWebhook;
