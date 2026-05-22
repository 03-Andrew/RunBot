"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStravaAuthorizeUrl = exports.getRawDiscordBody = exports.isValidDiscordRequest = void 0;
const requestUtils_1 = require("./requestUtils");
const hexToUint8Array = (hex) => {
    if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
        throw new Error("Invalid hex value");
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
};
const hexToBuffer = (hex) => Buffer.from(hex, "hex");
const createEd25519PublicKey = (publicKeyHex) => {
    const { createPublicKey } = require("node:crypto");
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const publicKeyDer = Buffer.concat([spkiPrefix, hexToBuffer(publicKeyHex)]);
    return createPublicKey({
        key: publicKeyDer,
        format: "der",
        type: "spki",
    });
};
const isValidDiscordRequest = (event, rawBody) => {
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    const signature = (0, requestUtils_1.getHeader)(event.headers, "x-signature-ed25519");
    const timestamp = (0, requestUtils_1.getHeader)(event.headers, "x-signature-timestamp");
    if (!publicKey || !signature || !timestamp) {
        return false;
    }
    try {
        const { verify } = require("node:crypto");
        const message = new TextEncoder().encode(timestamp + rawBody);
        return verify(null, Buffer.from(message), createEd25519PublicKey(publicKey), hexToUint8Array(signature));
    }
    catch {
        return false;
    }
};
exports.isValidDiscordRequest = isValidDiscordRequest;
exports.getRawDiscordBody = requestUtils_1.getRawBody;
const buildStravaAuthorizeUrl = (discordUserId, clientId) => {
    const redirect = "https://2i877vt1l9.execute-api.ap-southeast-1.amazonaws.com/strava/callback";
    const url = new URL("https://www.strava.com/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirect);
    url.searchParams.set("approval_prompt", "force");
    url.searchParams.set("scope", "activity:read_all");
    url.searchParams.set("state", discordUserId);
    return url.toString();
};
exports.buildStravaAuthorizeUrl = buildStravaAuthorizeUrl;
