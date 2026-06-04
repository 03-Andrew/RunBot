import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
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
  start_date?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  pr_count?: number;
  total_elevation_gain?: number;
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

export const getStoredStravaActivitiesByDiscordId = async (
  discordUserId: string
) => {
  const items: StravaActivity[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await db.send(
      new QueryCommand({
        TableName: "ActivityBot",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `USER#${discordUserId}`,
          ":sk": "ACTIVITY#",
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    items.push(...((result.Items as StravaActivity[] | undefined) ?? []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return items;
};

export const getStoredPersonalRecordsByDiscordId = async (discordUserId: string) => {
  const result = await db.send(
    new GetCommand({
      TableName: "ActivityBot",
      Key: {
        PK: `USER#${discordUserId}`,
        SK: "PERSONAL_RECORDS",
      },
    })
  );

  return result.Item as { personalRecords?: Record<string, StravaActivity> } | undefined;
};

export const fetchStravaActivitiesSince = async (
  user: StravaUserRecord,
  afterUnixSeconds: number
) => {
  const accessToken = await getStravaAccessToken(user);
  const allActivities: StravaActivity[] = [];

  const fetchPage = async (token: string, page: number) => {
    const response = await fetch(
      `${STRAVA_API_BASE}/athlete/activities?after=${afterUnixSeconds}&per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response;
  };

  let token = accessToken;

  for (let page = 1; page <= 10; page += 1) {
    let response = await fetchPage(token, page);

    if (response.status === 401) {
      const refreshed = await refreshStravaTokens(user);
      token = refreshed.access_token;
      response = await fetchPage(token, page);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to fetch Strava activities: ${response.status} ${errorBody}`
      );
    }

    const activities = (await response.json()) as StravaActivity[];
    allActivities.push(...activities);

    if (activities.length < 100) {
      break;
    }
  }

  return allActivities;
};
