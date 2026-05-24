import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "../storage";
import { buildStravaActivityMessage } from "../stravaActivityMessage";
import {
  fetchStravaActivity,
  type StravaUserRecord,
} from "../stravaApi";
import { isStravaWebhookJob, type StravaWebhookJob } from "../stravaWebhookJob";

declare const process: {
  env: {
    DISCORD_BOT_TOKEN?: string;
    DISCORD_CHANNEL_ID?: string;
  };
};

const postDiscordMessage = async (content: string) => {
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CHANNEL_ID) {
    throw new Error("Discord notification is not configured.");
  }

  return fetch(
    `https://discord.com/api/v10/channels/${process.env.DISCORD_CHANNEL_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    }
  );
};

const handleWebhookJob = async (job: StravaWebhookJob) => {
  if (job.objectType !== "activity" || !["create", "update"].includes(job.aspectType)) {
    console.log("Ignoring non-notifiable Strava webhook job", job);
    return;
  }

  const result = await db.send(
    new QueryCommand({
      TableName: "ActivityBot",
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `STRAVA#${job.ownerId}`,
      },
    })
  );

  const user = result.Items?.[0];

  if (!user) {
    console.log("No linked Discord user found for Strava owner", {
      ownerId: job.ownerId,
    });
    return;
  }

  const typedUser = user as StravaUserRecord;
  const discordUserId = user.DiscordID ?? typedUser.PK.replace("USER#", "");
  const activity = await fetchStravaActivity(typedUser, job.activityId);

  await db.send(
    new PutCommand({
      TableName: "ActivityBot",
      Item: {
        PK: `USER#${discordUserId}`,
        SK: `ACTIVITY#${activity.id}`,
        DiscordID: discordUserId,
        UpdatedAt: new Date().toISOString(),
        ...activity,
      },
    })
  );

  const discordResponse = await postDiscordMessage(
    buildStravaActivityMessage(activity, discordUserId)
  );

  if (!discordResponse.ok) {
    const errorBody = await discordResponse.text();
    throw new Error(
      `Discord message failed: ${discordResponse.status} ${errorBody}`
    );
  }

  console.log("Discord message sent for Strava activity", {
    ownerId: job.ownerId,
    activityId: job.activityId,
  });
};

export const handleProcessStravaWebhook = async (event: {
  Records?: Array<{ body?: string }>;
}) => {
  for (const record of event.Records ?? []) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(record.body ?? "{}");
    } catch (error) {
      throw new Error(`Invalid SQS message body: ${String(error)}`);
    }

    if (!isStravaWebhookJob(parsed)) {
      throw new Error("Invalid Strava webhook job");
    }

    await handleWebhookJob(parsed);
  }
};
