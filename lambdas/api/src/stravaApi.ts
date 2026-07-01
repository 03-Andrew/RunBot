import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "./storage";
import { type Logger, noopLogger } from "./logger";

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

export type ClubAthlete = {
  resource_state?: number;
  firstname?: string;
  lastname?: string;
};

export type ClubActivity = {
  athlete?: ClubAthlete;
  name?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  type?: string;
  sport_type?: string;
  workout_type?: number | null;
};

export type Club = {
  id: number;
  name?: string;
};

export type StoredStravaActivityRecord = StravaActivity & {
  PK: string;
  SK: string;
  DiscordID: string;
  UpdatedAt: string;
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

const refreshStravaTokens = async (user: StravaUserRecord, log: Logger) => {
  if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
    throw new Error("Strava is not configured.");
  }

  if (!user.RefreshToken) {
    throw new Error("Missing Strava refresh token.");
  }

  log.info("Refreshing Strava tokens", { userId: user.PK });

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
    log.error("Strava token refresh failed", { status: response.status });
    throw new Error("Failed to refresh Strava token.");
  }

  await persistStravaTokens(user, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  });

  log.info("Strava tokens refreshed successfully", { userId: user.PK, expiresAt: data.expires_at });
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };
};

export const getStravaAccessToken = async (user: StravaUserRecord, log: Logger = noopLogger) => {
  if (user.AccessToken && !isTokenExpiringSoon(user.ExpiresAt)) {
    return user.AccessToken;
  }

  const tokenResponse = await refreshStravaTokens(user, log);
  return tokenResponse.access_token;
};

export const getLinkedStravaUserByDiscordId = async (
  discordUserId: string,
  log: Logger = noopLogger
) => {
  const result = await db.send(
    new GetCommand({
      TableName: "ActivityBot",
      Key: {
        PK: `USER#${discordUserId}`,
        SK: "PROFILE",
      },
    })
  );

  const user = result.Item as StravaUserRecord | undefined;
  if (!user) {
    log.debug("No linked Strava user found", { discordUserId });
  }
  return user;
};

export const getStoredStravaActivitiesByDiscordId = async (
  discordUserId: string
) => {
  const items: StoredStravaActivityRecord[] = [];
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

    items.push(...((result.Items as StoredStravaActivityRecord[] | undefined) ?? []));
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

export const sanitizeForDynamoDB = <T>(obj: T): T => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "number") {
    if (obj > Number.MAX_SAFE_INTEGER || obj < Number.MIN_SAFE_INTEGER) {
      return String(obj) as unknown as T;
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(sanitizeForDynamoDB) as unknown as T;
  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      sanitized[k] = sanitizeForDynamoDB(v);
    }
    return sanitized as T;
  }
  return obj;
};

const fetchWithTokenRefresh = async (
  user: StravaUserRecord,
  log: Logger,
  makeRequest: (token: string) => Promise<Response>
): Promise<Response> => {
  const accessToken = await getStravaAccessToken(user, log);
  let response = await makeRequest(accessToken);

  if (response.status === 401) {
    log.info("Strava API returned 401 — refreshing token and retrying");
    const refreshed = await refreshStravaTokens(user, log);
    response = await makeRequest(refreshed.access_token);
  }

  return response;
};

export const fetchStravaActivity = async (
  user: StravaUserRecord,
  activityId: number,
  log: Logger = noopLogger
) => {
  const startedAt = Date.now();
  const response = await fetchWithTokenRefresh(user, log, (token) =>
    fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  );

  if (!response.ok) {
    const errorBody = await response.text();
    log.error("Failed to fetch Strava activity", {
      activityId,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`Failed to fetch Strava activity: ${response.status} ${errorBody}`);
  }

  log.debug("Fetched Strava activity", { activityId, durationMs: Date.now() - startedAt });
  return (await response.json()) as StravaActivity;
};

export const fetchStravaActivitiesSince = async (
  user: StravaUserRecord,
  afterUnixSeconds: number,
  log: Logger = noopLogger
) => {
  const allActivities: StravaActivity[] = [];
  const startedAt = Date.now();
  let token = await getStravaAccessToken(user, log);

  for (let page = 1; page <= 10; page += 1) {
    let response = await fetch(
      `${STRAVA_API_BASE}/athlete/activities?after=${afterUnixSeconds}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (response.status === 401) {
      log.info("Strava API returned 401 during activity fetch — refreshing token");
      const refreshed = await refreshStravaTokens(user, log);
      token = refreshed.access_token;
      response = await fetch(
        `${STRAVA_API_BASE}/athlete/activities?after=${afterUnixSeconds}&per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      log.error("Failed to fetch Strava activities", {
        page,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      throw new Error(`Failed to fetch Strava activities: ${response.status} ${errorBody}`);
    }

    const activities = (await response.json()) as StravaActivity[];
    allActivities.push(...activities);

    if (activities.length < 100) {
      break;
    }
  }

  log.debug("Fetched Strava activities", {
    count: allActivities.length,
    durationMs: Date.now() - startedAt,
  });
  return allActivities;
};

export const getClubActivitiesById = async (
  user: StravaUserRecord,
  clubId: string,
  page = 1,
  perPage = 30,
  log: Logger = noopLogger
) => {
  const startedAt = Date.now();
  const response = await fetchWithTokenRefresh(user, log, (token) => {
    const url = new URL(`${STRAVA_API_BASE}/clubs/${clubId}/activities`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error("Failed to fetch club activities", {
      clubId,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`Failed to fetch Strava club activities: ${response.status} ${errorBody}`);
  }

  log.debug("Fetched club activities", { clubId, durationMs: Date.now() - startedAt });
  return (await response.json()) as ClubActivity[];
};

export const getClubById = async (
  user: StravaUserRecord,
  clubId: string,
  log: Logger = noopLogger
) => {
  const startedAt = Date.now();
  const response = await fetchWithTokenRefresh(user, log, (token) =>
    fetch(`${STRAVA_API_BASE}/clubs/${clubId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  );

  if (!response.ok) {
    const errorBody = await response.text();
    log.error("Failed to fetch club", {
      clubId,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    throw new Error(`Failed to fetch Strava club: ${response.status} ${errorBody}`);
  }

  log.debug("Fetched club info", { clubId, durationMs: Date.now() - startedAt });
  return (await response.json()) as Club;
};
