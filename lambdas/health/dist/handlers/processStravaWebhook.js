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
const RECENT_LOOKBACK_DAYS = 30;
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
const isRunningActivity = (activity) => {
    const labels = [activity.type, activity.sport_type].filter((label) => typeof label === "string");
    return labels.some((label) => /run/i.test(label));
};
const getActivityTimestamp = (activity) => {
    if (activity.start_date) {
        const startedAt = new Date(activity.start_date).getTime();
        if (!Number.isNaN(startedAt)) {
            return startedAt;
        }
    }
    if (activity.UpdatedAt) {
        const updatedAt = new Date(activity.UpdatedAt).getTime();
        if (!Number.isNaN(updatedAt)) {
            return updatedAt;
        }
    }
    return 0;
};
const dedupeAndSortRuns = (activities) => {
    const deduped = new Map();
    for (const activity of activities) {
        if (typeof activity.id !== "number") {
            continue;
        }
        if (!isRunningActivity(activity)) {
            continue;
        }
        const existing = deduped.get(activity.id);
        if (!existing || getActivityTimestamp(activity) > getActivityTimestamp(existing)) {
            deduped.set(activity.id, activity);
        }
    }
    return [...deduped.values()].sort((a, b) => getActivityTimestamp(b) - getActivityTimestamp(a));
};
const callAiCoach = async (payload) => {
    if (!process.env.AI_COACH_URL) {
        throw new Error("AI coach endpoint is not configured.");
    }
    const response = await fetch(process.env.AI_COACH_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-runbot-ai-token": process.env.AI_COACH_TOKEN ?? "",
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`AI coach failed: ${response.status} ${errorBody}`);
    }
    const data = (await response.json());
    return data.analysis ?? "";
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
    if (!user && job.commandName !== "ai-chat") {
        const response = await (0, discordFollowup_1.postDiscordInteractionFollowUp)(job.interactionToken, "No Strava account is linked yet. Run `/strava` first.");
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Discord follow-up failed: ${response.status} ${errorBody}`);
        }
        return;
    }
    const linkedUser = user;
    try {
        if (job.commandName === "ai-chat") {
            const analysis = await callAiCoach({
                prompt: job.prompt ?? "",
                discordUserId: job.discordUserId,
            });
            const response = await (0, discordFollowup_1.postDiscordInteractionFollowUp)(job.interactionToken, analysis || "Could not generate a response right now.");
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Discord follow-up failed: ${response.status} ${errorBody}`);
            }
            return;
        }
        if (job.commandName === "stats") {
            const afterUnixSeconds = (0, stravaStats_1.getCurrentWeekStartUnixSeconds)();
            const activities = await (0, stravaApi_1.fetchStravaActivitiesSince)(linkedUser, afterUnixSeconds);
            const response = await (0, discordFollowup_1.postDiscordInteractionFollowUp)(job.interactionToken, (0, stravaStats_1.buildWeeklyStatsMessage)(activities));
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Discord follow-up failed: ${response.status} ${errorBody}`);
            }
            return;
        }
        if (job.commandName === "analyse-run") {
            const lookbackSince = Math.floor(Date.now() / 1000) - RECENT_LOOKBACK_DAYS * 24 * 60 * 60;
            const [recentActivities, storedActivities] = await Promise.all([
                (0, stravaApi_1.fetchStravaActivitiesSince)(linkedUser, lookbackSince),
                (0, stravaApi_1.getStoredStravaActivitiesByDiscordId)(job.discordUserId),
            ]);
            const allRuns = dedupeAndSortRuns([...recentActivities, ...storedActivities]);
            const recentRuns = allRuns.slice(0, 5);
            const historicalRuns = allRuns.slice(5, 15);
            const latestRun = recentRuns[0] ?? historicalRuns[0];
            const weeklySummary = (0, stravaStats_1.calculateWeeklyStats)(recentActivities);
            if (!latestRun) {
                const response = await (0, discordFollowup_1.postDiscordInteractionFollowUp)(job.interactionToken, "I could not find enough run history to analyse yet.");
                if (!response.ok) {
                    const errorBody = await response.text();
                    throw new Error(`Discord follow-up failed: ${response.status} ${errorBody}`);
                }
                return;
            }
            const analysis = await callAiCoach({
                athleteName: "unknown",
                latestRun,
                recentRuns,
                historicalRuns,
                weeklySummary,
            });
            const response = await (0, discordFollowup_1.postDiscordInteractionFollowUp)(job.interactionToken, analysis || "Could not generate a run analysis right now.");
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Discord follow-up failed: ${response.status} ${errorBody}`);
            }
            return;
        }
        const club = await (0, stravaApi_1.getClubById)(linkedUser, DEFAULT_CLUB_ID);
        const activities = await (0, stravaApi_1.getClubActivitiesById)(linkedUser, DEFAULT_CLUB_ID, 1, 30);
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
