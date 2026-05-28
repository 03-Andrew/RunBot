"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDiscordInteractions = void 0;
const discord_1 = require("../discord");
const requestUtils_1 = require("../requestUtils");
const http_1 = require("../http");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const sqs = new client_sqs_1.SQSClient({});
const getSubcommandName = (options) => options?.find((option) => option?.type === 1)?.name;
const getStringOptionValue = (options, name) => {
    const option = options?.find((entry) => entry?.name === name && entry?.type === 3);
    return typeof option?.value === "string" ? option.value : undefined;
};
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
        "`/stats` - Queue your weekly Strava stats",
        "`/club-activities` - Queue recent activities from the default Strava club",
        "`/analyse run` - Queue an AI review of your latest run and training trend",
        "`/ai <prompt>` - Chat with the AI coach using natural language",
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
    if (body.data?.name === "ai") {
        const discordUserId = body.member?.user?.id ?? body.user?.id;
        const prompt = getStringOptionValue(body.data?.options, "prompt")?.trim();
        if (!discordUserId) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not identify your Discord user.",
                },
            });
        }
        if (!prompt) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Please provide a prompt for `/ai`.",
                },
            });
        }
        const queueUrl = process.env.SQS_QUEUE_URL;
        if (!queueUrl) {
            console.error("SQS queue is not configured");
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Queue is not configured yet.",
                },
            });
        }
        const message = {
            kind: "discord-slash-command",
            commandName: "ai-chat",
            interactionToken: body.token,
            discordUserId,
            prompt,
        };
        try {
            const response = await sqs.send(new client_sqs_1.SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(message),
            }));
            console.log("Queued Discord slash command job", {
                commandName: "ai-chat",
                discordUserId,
                messageId: response.MessageId,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 5,
            });
        }
        catch (error) {
            console.error("Failed to queue Discord slash command job", {
                commandName: "ai-chat",
                discordUserId,
                error,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not queue your AI request right now.",
                },
            });
        }
    }
    if (body.data?.name === "stats") {
        const discordUserId = body.member?.user?.id ?? body.user?.id;
        if (!discordUserId) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not identify your Discord user.",
                },
            });
        }
        const queueUrl = process.env.SQS_QUEUE_URL;
        if (!queueUrl) {
            console.error("SQS queue is not configured");
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Queue is not configured yet.",
                },
            });
        }
        const message = {
            kind: "discord-slash-command",
            commandName: "stats",
            interactionToken: body.token,
            discordUserId,
        };
        try {
            const response = await sqs.send(new client_sqs_1.SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(message),
            }));
            console.log("Queued Discord slash command job", {
                commandName: "stats",
                discordUserId,
                messageId: response.MessageId,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 5,
            });
        }
        catch (error) {
            console.error("Failed to queue Discord slash command job", {
                commandName: "stats",
                discordUserId,
                error,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not queue your stats request right now.",
                },
            });
        }
    }
    if (body.data?.name === "analyse" && getSubcommandName(body.data?.options) === "run") {
        const discordUserId = body.member?.user?.id ?? body.user?.id;
        if (!discordUserId) {
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not identify your Discord user.",
                },
            });
        }
        const queueUrl = process.env.SQS_QUEUE_URL;
        if (!queueUrl) {
            console.error("SQS queue is not configured");
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Queue is not configured yet.",
                },
            });
        }
        const message = {
            kind: "discord-slash-command",
            commandName: "analyse-run",
            interactionToken: body.token,
            discordUserId,
        };
        try {
            const response = await sqs.send(new client_sqs_1.SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(message),
            }));
            console.log("Queued Discord slash command job", {
                commandName: "analyse-run",
                discordUserId,
                messageId: response.MessageId,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 5,
            });
        }
        catch (error) {
            console.error("Failed to queue Discord slash command job", {
                commandName: "analyse-run",
                discordUserId,
                error,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not queue your analysis request right now.",
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
                },
            });
        }
        const queueUrl = process.env.SQS_QUEUE_URL;
        if (!queueUrl) {
            console.error("SQS queue is not configured");
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Queue is not configured yet.",
                },
            });
        }
        const message = {
            kind: "discord-slash-command",
            commandName: "club-activities",
            interactionToken: body.token,
            discordUserId,
        };
        try {
            const response = await sqs.send(new client_sqs_1.SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(message),
            }));
            console.log("Queued Discord slash command job", {
                commandName: "club-activities",
                discordUserId,
                messageId: response.MessageId,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 5,
            });
        }
        catch (error) {
            console.error("Failed to queue Discord slash command job", {
                commandName: "club-activities",
                discordUserId,
                error,
            });
            return (0, http_1.jsonResponse)(200, {
                type: 4,
                data: {
                    content: "Could not queue your club request right now.",
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
