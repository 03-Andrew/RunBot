import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { db } from "../storage";
import { htmlResponse, textResponse } from "../http";
import { postDiscordMessage, resolveStateNonce, sendDiscordDM } from "../discord";
import { stravaConnectedPage } from "./stravaConnectedPage";
import { type Logger, noopLogger } from "../logger";

declare const process: {
  env: {
    STRAVA_CLIENT_ID?: string;
    STRAVA_CLIENT_SECRET?: string;
    DISCORD_CHANNEL_ID?: string;
    DISCORD_BOT_TOKEN?: string;
    SQS_QUEUE_URL?: string;
  };
};

const sqs = new SQSClient({});

export const handleStravaCallback = async (
  event: {
    queryStringParameters?: Record<string, string | undefined> | null;
  },
  log: Logger = noopLogger
) => {
  const code = event.queryStringParameters?.code;
  const stateNonce = event.queryStringParameters?.state;

  if (!code || !stateNonce) {
    return textResponse(400, "Missing Strava authorization code or state.");
  }

  const discordId = await resolveStateNonce(stateNonce);
  if (!discordId) {
    return textResponse(400, "Invalid or expired state parameter. Please run /strava again.");
  }

  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
    return textResponse(500, "Strava is not configured.");
  }

  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.athlete?.id) {
    log.error("Strava token exchange failed", {
      status: response.status,
      message: data.message,
    });

    return textResponse(400, "Could not connect Strava. Please try /strava again.");
  }

  const athleteId = data.athlete.id;

  await db.send(
    new PutCommand({
      TableName: "ActivityBot",
      Item: {
        PK: `USER#${discordId}`,
        SK: "PROFILE",
        DiscordID: discordId,
        StravaID: athleteId,
        AccessToken: data.access_token,
        RefreshToken: data.refresh_token,
        ExpiresAt: data.expires_at,
        GSI1PK: `STRAVA#${athleteId}`,
        GSI1SK: "PROFILE",
      },
    })
  );

  log.info("Strava account linked", { discordId, athleteId });

  if (process.env.DISCORD_CHANNEL_ID) {
    try {
      await postDiscordMessage(
        process.env.DISCORD_CHANNEL_ID,
        `🏃‍♂️🤖 **Account Linked!** <@${discordId}> has successfully connected their Strava account.`
      );
    } catch (err: any) {
      log.error("Failed to notify Discord channel", { error: err.message });
    }
  }

  try {
    await sendDiscordDM(
      discordId,
      `👋 **Strava Connected!** Your Strava account is now connected to RunBot. You can now use slash commands like \`/stats\`, \`/club-activities\`, and \`/analyse run\` directly in Discord!`
    );
  } catch (err: any) {
    log.error("Failed to send Discord DM", { error: err.message });
  }

  if (process.env.SQS_QUEUE_URL) {
    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: process.env.SQS_QUEUE_URL,
          MessageBody: JSON.stringify({
            kind: "strava-backfill",
            discordUserId: discordId,
            lookbackDays: 730,
          }),
        })
      );
      log.info("Queued Strava backfill job", { discordUserId: discordId });
    } catch (err: any) {
      log.error("Failed to queue Strava backfill job", { error: err.message });
    }
  }

  return htmlResponse(200, stravaConnectedPage);
};
