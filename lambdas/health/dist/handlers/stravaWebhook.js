"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStravaWebhook = void 0;
const client_sqs_1 = require("@aws-sdk/client-sqs");
const http_1 = require("../http");
const requestUtils_1 = require("../requestUtils");
const sqs = new client_sqs_1.SQSClient({});
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
    const queueUrl = process.env.SQS_QUEUE_URL;
    if (!queueUrl) {
        console.error("SQS queue is not configured");
        return (0, http_1.textResponse)(500, "Queue not configured");
    }
    const message = {
        kind: "strava-webhook",
        ownerId: owner,
        activityId,
        objectType,
        aspectType,
    };
    try {
        const response = await sqs.send(new client_sqs_1.SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(message),
        }));
        console.log("Queued Strava webhook job", {
            ownerId: owner,
            activityId,
            messageId: response.MessageId,
        });
        return (0, http_1.jsonResponse)(200, {
            queued: true,
            received: true,
        });
    }
    catch (error) {
        console.error("Failed to queue Strava webhook job", {
            ownerId: owner,
            activityId,
            error,
        });
        return (0, http_1.textResponse)(500, "Failed to queue webhook");
    }
};
exports.handleStravaWebhook = handleStravaWebhook;
