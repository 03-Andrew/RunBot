import nacl from "tweetnacl";
import { getHeader, getRawBody } from "./requestUtils";

declare const process: {
  env: {
    DISCORD_PUBLIC_KEY?: string;
    STRAVA_CLIENT_ID?: string;
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
    const message = new TextEncoder().encode(timestamp + rawBody);
    return nacl.sign.detached.verify(
      message,
      hexToUint8Array(signature),
      hexToUint8Array(publicKey)
    );
  } catch {
    return false;
  }
};

export const getRawDiscordBody = getRawBody;

export const buildStravaAuthorizeUrl = (discordUserId: string, clientId: string) => {
  const redirect =
    "https://2i877vt1l9.execute-api.ap-southeast-1.amazonaws.com/strava/callback";

  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("approval_prompt", "force");
  url.searchParams.set("scope", "activity:read_all");
  url.searchParams.set("state", discordUserId);

  return url.toString();
};

