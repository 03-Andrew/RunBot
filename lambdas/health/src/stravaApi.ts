import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "./storage";

export type StravaUserRecord = {
  PK: string;
  SK: string;
  AccessToken?: string;
  RefreshToken?: string;
  ExpiresAt?: number;
};

type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

export type StravaActivity = {
  id: number;
  name?: string;
  sport_type?: string;
  type?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  pr_count?: number;
};

declare const process: {
  env: {
    STRAVA_CLIENT_ID?: string;
    STRAVA_CLIENT_SECRET?: string;
  };
};

const STRAVA_API_BASE = "https://www.strava.com/api/v3";

const isTokenExpiringSoon = (expiresAt?: number) => {
  if (!expiresAt) {
    return true;
  }

  return expiresAt <= Math.floor(Date.now() / 1000) + 3600;
};

const persistStravaTokens = async (
  user: StravaUserRecord,
  tokenResponse: StravaTokenResponse
) => {
  await db.send(
    new UpdateCommand({
      TableName: "ActivityBot",
      Key: {
        PK: user.PK,
        SK: user.SK,
      },
      UpdateExpression:
        "SET AccessToken = :accessToken, RefreshToken = :refreshToken, ExpiresAt = :expiresAt",
      ExpressionAttributeValues: {
        ":accessToken": tokenResponse.access_token,
        ":refreshToken": tokenResponse.refresh_token,
        ":expiresAt": tokenResponse.expires_at,
      },
    })
  );
};

const refreshStravaTokens = async (user: StravaUserRecord) => {
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
    throw new Error("Strava is not configured.");
  }

  if (!user.RefreshToken) {
    throw new Error("Missing Strava refresh token.");
  }

  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: user.RefreshToken,
    }),
  });

  const data = (await response.json()) as Partial<StravaTokenResponse>;

  if (!response.ok || !data.access_token || !data.refresh_token || !data.expires_at) {
    throw new Error("Failed to refresh Strava token.");
  }

  const tokenResponse = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };

  await persistStravaTokens(user, tokenResponse);

  return tokenResponse;
};

export const getStravaAccessToken = async (user: StravaUserRecord) => {
  if (user.AccessToken && !isTokenExpiringSoon(user.ExpiresAt)) {
    return user.AccessToken;
  }

  const tokenResponse = await refreshStravaTokens(user);
  return tokenResponse.access_token;
};

export const getLinkedStravaUserByDiscordId = async (discordUserId: string) => {
  const result = await db.send(
    new GetCommand({
      TableName: "ActivityBot",
      Key: {
        PK: `USER#${discordUserId}`,
        SK: "PROFILE",
      },
    })
  );

  return result.Item as StravaUserRecord | undefined;
};

export const fetchStravaActivity = async (
  user: StravaUserRecord,
  activityId: number
) => {
  const accessToken = await getStravaAccessToken(user);

  const fetchActivity = async (token: string) => {
    const response = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response;
  };

  let response = await fetchActivity(accessToken);

  if (response.status === 401) {
    const refreshed = await refreshStravaTokens(user);
    response = await fetchActivity(refreshed.access_token);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch Strava activity: ${response.status} ${errorBody}`);
  }

  return (await response.json()) as StravaActivity;
};

export const fetchLatestStravaActivity = async (user: StravaUserRecord) => {
  const accessToken = await getStravaAccessToken(user);

  const fetchActivities = async (token: string) => {
    const response = await fetch(
      `${STRAVA_API_BASE}/athlete/activities?per_page=1&page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response;
  };

  let response = await fetchActivities(accessToken);

  if (response.status === 401) {
    const refreshed = await refreshStravaTokens(user);
    response = await fetchActivities(refreshed.access_token);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to fetch latest Strava activity: ${response.status} ${errorBody}`);
  }

  const activities = (await response.json()) as StravaActivity[];
  return activities[0];
};
