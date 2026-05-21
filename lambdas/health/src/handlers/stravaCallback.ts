import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "../storage";
import { htmlResponse, textResponse } from "../http";
import { stravaConnectedPage } from "../stravaConnectedPage";

declare const process: {
  env: {
    STRAVA_CLIENT_ID?: string;
    STRAVA_CLIENT_SECRET?: string;
  };
};

export const handleStravaCallback = async (event: {
  queryStringParameters?: Record<string, string | undefined> | null;
}) => {
  const code = event.queryStringParameters?.code;
  const discordId = event.queryStringParameters?.state;

  if (!code || !discordId) {
    return textResponse(400, "Missing Strava authorization code or state.");
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
    console.error("Strava token exchange failed", {
      status: response.status,
      message: data.message,
      errors: data.errors,
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

  return htmlResponse(200, stravaConnectedPage);
};

