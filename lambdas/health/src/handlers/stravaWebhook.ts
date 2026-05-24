import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { jsonResponse, textResponse } from "../http";
import { getRawBody } from "../requestUtils";
import type { StravaWebhookJob } from "../stravaWebhookJob";

declare const process: {
  env: {
    VERIFY_TOKEN?: string;
    SQS_QUEUE_URL?: string;
  };
};

const sqs = new SQSClient({});

export const handleStravaWebhook = async (event: {
  body?: string | null;
  isBase64Encoded?: boolean;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
}) => {
  if (event.requestContext?.http?.method === "GET") {
    const challenge = event.queryStringParameters?.["hub.challenge"];
    const verifyToken = event.queryStringParameters?.["hub.verify_token"];

    if (verifyToken !== process.env.VERIFY_TOKEN) {
      return textResponse(403, "Invalid token");
    }

    return jsonResponse(200, { "hub.challenge": challenge });
  }

  const rawBody = getRawBody(event);
  const body = JSON.parse(rawBody || "{}");
  const owner = body.owner_id;
  const activityId = Number(body.object_id);
  const objectType = body.object_type;
  const aspectType = body.aspect_type;

  console.log("incoming webhook");
  console.log(JSON.stringify(body));

  if (!owner) {
    console.log("Ignoring Strava webhook without owner_id");

    return jsonResponse(200, {
      ignored: true,
      reason: "missing_owner_id",
    });
  }

  if (objectType !== "activity" || !["create", "update"].includes(aspectType)) {
    console.log("Ignoring non-notifiable Strava webhook", {
      objectType,
      aspectType,
    });

    return jsonResponse(200, {
      ignored: true,
      reason: "not_notifiable",
    });
  }

  if (!activityId) {
    console.log("Ignoring Strava webhook without object_id");

    return jsonResponse(200, {
      ignored: true,
      reason: "missing_object_id",
    });
  }

  const queueUrl = process.env.SQS_QUEUE_URL;
  if (!queueUrl) {
    console.error("SQS queue is not configured");
    return textResponse(500, "Queue not configured");
  }

  const message: StravaWebhookJob = {
    ownerId: owner,
    activityId,
    objectType,
    aspectType,
  };

  try {
    const response = await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
      })
    );

    console.log("Queued Strava webhook job", {
      ownerId: owner,
      activityId,
      messageId: response.MessageId,
    });

    return jsonResponse(200, {
      queued: true,
      received: true,
    });
  } catch (error) {
    console.error("Failed to queue Strava webhook job", {
      ownerId: owner,
      activityId,
      error,
    });

    return textResponse(500, "Failed to queue webhook");
  }
};
