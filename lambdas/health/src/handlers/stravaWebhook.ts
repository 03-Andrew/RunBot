import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "../storage";
import { jsonResponse, textResponse } from "../http";
import { getRawBody } from "../requestUtils";
import { buildStravaActivityMessage } from "../stravaActivityMessage";
import { fetchStravaActivity, type StravaUserRecord } from "../stravaApi";

declare const process: {
  env: {
    VERIFY_TOKEN?: string;
    DISCORD_BOT_TOKEN?: string;
    DISCORD_CHANNEL_ID?: string;
  };
};

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

  console.log("Looking up linked Discord user", {
    gsi1pk: `STRAVA#${owner}`,
  });

  const result = await db.send(
    new QueryCommand({
      TableName: "ActivityBot",
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK=:pk",
      ExpressionAttributeValues: {
        ":pk": `STRAVA#${owner}`,
      },
    })
  );

  const user = result.Items?.[0];

  if (!user) {
    console.log("No user found");

    return jsonResponse(200, {
      ignored: true,
    });
  }

  console.log("Found Discord user:", user.DiscordID);

  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CHANNEL_ID) {
    console.error("Discord notification is not configured", {
      hasBotToken: Boolean(process.env.DISCORD_BOT_TOKEN),
      hasChannelId: Boolean(process.env.DISCORD_CHANNEL_ID),
    });

    return jsonResponse(200, {
      received: true,
      discordId: user.DiscordID,
      notified: false,
      reason: "discord_not_configured",
    });
  }

  const typedUser = user as StravaUserRecord;
  let activity;

  try {
    activity = await fetchStravaActivity(typedUser, activityId);
  } catch (error) {
    console.error("Failed to fetch Strava activity", {
      activityId,
      error,
    });

    return jsonResponse(200, {
      received: true,
      discordId: user.DiscordID,
      notified: false,
      reason: "activity_fetch_failed",
    });
  }

  await db.send(
    new PutCommand({
      TableName: "ActivityBot",
      Item: {
        PK: `USER#${user.DiscordID}`,
        SK: `ACTIVITY#${activity.id}`,
        DiscordID: user.DiscordID,
        UpdatedAt: new Date().toISOString(),
        ...activity,
      },
    })
  );

  const discordResponse = await fetch(
    `https://discord.com/api/v10/channels/${process.env.DISCORD_CHANNEL_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: buildStravaActivityMessage(activity, user.DiscordID),
      }),
    }
  );

  console.log("Discord API response", discordResponse);

  if (!discordResponse.ok) {
    const errorBody = await discordResponse.text();
    console.error("Discord message failed", {
      status: discordResponse.status,
      body: errorBody,
    });

    return jsonResponse(200, {
      received: true,
      discordId: user.DiscordID,
      notified: false,
      discordStatus: discordResponse.status,
    });
  }

  console.log("Discord message sent");

  return jsonResponse(200, {
    received: true,
    discordId: user.DiscordID,
    notified: true,
  });
};
