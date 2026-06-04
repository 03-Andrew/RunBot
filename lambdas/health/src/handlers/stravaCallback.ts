import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "../storage";
import { htmlResponse, textResponse } from "../http";

declare const process: {
  env: {
    STRAVA_CLIENT_ID?: string;
    STRAVA_CLIENT_SECRET?: string;
  };
};

const stravaConnectedPage = `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Strava Connected</title>
      <style>
        :root {
          color-scheme: light;
          font-family: Arial, Helvetica, sans-serif;
        }

        * {
          box-sizing: border-box;
        }

        body {
          min-height: 100vh;
          margin: 0;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at top, rgba(252, 76, 2, 0.18), transparent 34rem),
            linear-gradient(135deg, #fff7f2 0%, #f7f7f4 48%, #ffffff 100%);
          color: #242428;
          padding: 24px;
        }

        .card {
          width: min(100%, 420px);
          text-align: center;
          background: #ffffff;
          border: 1px solid #f0e6df;
          border-radius: 8px;
          box-shadow: 0 24px 70px rgba(36, 36, 40, 0.14);
          padding: 36px 30px 30px;
        }

        .mark {
          width: 64px;
          height: 64px;
          margin: 0 auto 22px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: #fc4c02;
          color: #ffffff;
          font-size: 34px;
          line-height: 1;
        }

        h1 {
          margin: 0 0 10px;
          font-size: 28px;
          line-height: 1.2;
          letter-spacing: 0;
        }

        p {
          margin: 0 0 26px;
          color: #5f6267;
          font-size: 16px;
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
      <main class="card">
        <div class="mark" aria-hidden="true">✓</div>
        <h1>Strava Connected</h1>
        <p>Your Strava account is connected to Discord. You may now exit this tab.</p>
      </main>
    </body>
  </html>
`;

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
