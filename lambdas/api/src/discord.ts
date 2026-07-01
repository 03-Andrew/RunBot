import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "./storage";
import { getHeader, getRawBody } from "./http";
import { type Logger, noopLogger } from "./logger";

declare const Buffer: any;
declare const require: any;

declare const process: {
  env: {
    DISCORD_PUBLIC_KEY?: string;
    STRAVA_CLIENT_ID?: string;
    DISCORD_APPLICATION_ID?: string;
    DISCORD_BOT_TOKEN?: string;
    DISCORD_CHANNEL_ID?: string;
  };
};

const hexToUint8Array = (hex: string) => {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error("Invalid hex value");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
};

const hexToBuffer = (hex: string) => Buffer.from(hex, "hex");

const createEd25519PublicKey = (publicKeyHex: string) => {
  const { createPublicKey } = require("node:crypto");
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const publicKeyDer = Buffer.concat([spkiPrefix, hexToBuffer(publicKeyHex)]);

  return createPublicKey({
    key: publicKeyDer,
    format: "der",
    type: "spki",
  });
};

export const isValidDiscordRequest = (
  event: { headers?: Record<string, string | undefined>; body?: string | null; isBase64Encoded?: boolean },
  rawBody: string
) => {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const signature = getHeader(event.headers, "x-signature-ed25519");
  const timestamp = getHeader(event.headers, "x-signature-timestamp");

  if (!publicKey || !signature || !timestamp) {
    return false;
  }

  try {
    const { verify } = require("node:crypto");
    const message = new TextEncoder().encode(timestamp + rawBody);
    return verify(
      null,
      Buffer.from(message),
      createEd25519PublicKey(publicKey),
      hexToUint8Array(signature)
    );
  } catch {
    return false;
  }
};

export const getRawDiscordBody = getRawBody;

const STATE_TTL_SECONDS = 600;

export const buildStravaAuthorizeUrl = async (discordUserId: string, clientId: string) => {
  const { randomBytes } = require("node:crypto");
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;

  await db.send(
    new PutCommand({
      TableName: "ActivityBot",
      Item: {
        PK: `STATE#${nonce}`,
        SK: "STATE",
        discordUserId,
        expiresAt,
      },
    })
  );

  const redirect =
    "https://2i877vt1l9.execute-api.ap-southeast-1.amazonaws.com/strava/callback";

  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("approval_prompt", "force");
  url.searchParams.set("scope", "activity:read_all");
  url.searchParams.set("state", nonce);

  return url.toString();
};

export const resolveStateNonce = async (nonce: string): Promise<string | null> => {
  const result = await db.send(
    new GetCommand({
      TableName: "ActivityBot",
      Key: { PK: `STATE#${nonce}`, SK: "STATE" },
    })
  );

  if (!result.Item) return null;

  const expiresAt = result.Item.expiresAt as number;
  if (Date.now() / 1000 > expiresAt) return null;

  await db.send(
    new DeleteCommand({
      TableName: "ActivityBot",
      Key: { PK: `STATE#${nonce}`, SK: "STATE" },
    })
  );

  return result.Item.discordUserId as string;
};

export const postDiscordInteractionFollowUp = async (
  interactionToken: string,
  content: string
) => {
  if (!process.env.DISCORD_APPLICATION_ID) {
    throw new Error("Discord application id is not configured.");
  }

  return fetch(
    `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interactionToken}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    }
  );
};

export const postDiscordMessage = async (
  channelId: string,
  content: string,
  log: Logger = noopLogger
) => {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error("Discord bot token is not configured.");
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    log.error("Failed to post Discord message", { status: response.status });
  }
  return response;
};

export const sendDiscordDM = async (
  userId: string,
  content: string,
  log: Logger = noopLogger
) => {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error("Discord bot token is not configured.");
  }

  try {
    const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: userId }),
    });

    if (!channelResponse.ok) {
      log.error("Failed to create DM channel", { status: channelResponse.status });
      return channelResponse;
    }

    const channelData = (await channelResponse.json()) as { id: string };
    return await postDiscordMessage(channelData.id, content, log);
  } catch (error: any) {
    log.error("Error sending Discord DM", { error: error.message });
  }
};
