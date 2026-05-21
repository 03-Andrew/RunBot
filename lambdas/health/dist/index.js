"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const tweetnacl_1 = __importDefault(require("tweetnacl"));
const stravaConnectedPage_1 = require("./stravaConnectedPage");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client = new client_dynamodb_1.DynamoDBClient({});
const db = lib_dynamodb_1.DynamoDBDocumentClient.from(client);
const jsonHeaders = {
    "Content-Type": "application/json",
};
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
const getHeader = (headers, name) => {
    if (!headers) {
        return undefined;
    }
    return (headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]);
};
const getRawBody = (event) => {
    const body = event.body ?? "";
    if (event.isBase64Encoded) {
        return Buffer.from(body, "base64").toString("utf8");
    }
    return body;
};
const isValidDiscordRequest = (event, rawBody) => {
    const publicKey = process.env.DISCORD_PUBLIC_KEY;
    const signature = getHeader(event.headers, "x-signature-ed25519");
    const timestamp = getHeader(event.headers, "x-signature-timestamp");
    if (!publicKey || !signature || !timestamp) {
        return false;
    }
    try {
        const message = new TextEncoder().encode(timestamp + rawBody);
        return tweetnacl_1.default.sign.detached.verify(message, hexToUint8Array(signature), hexToUint8Array(publicKey));
    }
    catch {
        return false;
    }
};
const handler = async (event) => {
    const path = event.requestContext?.http?.path;
    const method = event.requestContext?.http?.method;
    // Health endpoint
    if (path === "/health" && method === "GET") {
        return {
            statusCode: 200,
            body: JSON.stringify({
                status: "ok",
            }),
        };
    }
    // Strava OAuth callback
    if (path === "/strava/callback" && method === "GET") {
        const code = event.queryStringParameters?.code;
        const discordId = event.queryStringParameters?.state;
        const response = await fetch("https://www.strava.com/oauth/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: process.env.STRAVA_CLIENT_ID,
                client_secret: process.env.STRAVA_CLIENT_SECRET,
                code,
                grant_type: "authorization_code",
            }),
        });
        if (!code || !discordId) {
            return {
                statusCode: 400,
                body: "Missing Strava authorization code or state.",
            };
        }
        const data = await response.json();
        const athleteId = data.athlete.id;
        await db.send(new lib_dynamodb_1.PutCommand({
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
        }));
        return {
            statusCode: 200,
            headers: {
                "Content-Type": "text/html",
            },
            body: stravaConnectedPage_1.stravaConnectedPage,
        };
    }
    if (path === "/strava/webhook") {
        if (method === "GET") {
            const challenge = event.queryStringParameters?.["hub.challenge"];
            const verifyToken = event.queryStringParameters?.["hub.verify_token"];
            if (verifyToken !== process.env.VERIFY_TOKEN) {
                return {
                    statusCode: 403,
                    body: "Invalid token",
                };
            }
            return {
                statusCode: 200,
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    "hub.challenge": challenge,
                }),
            };
        }
        if (method === "POST") {
            const body = JSON.parse(event.body);
            console.log("WEBHOOK EVENT:");
            console.log(JSON.stringify(body));
            return {
                statusCode: 200,
                body: JSON.stringify({
                    received: true,
                }),
            };
        }
    }
    // Discord endpoint
    if (path === "/discord-interactions" && method === "POST") {
        const rawBody = getRawBody(event);
        if (!isValidDiscordRequest(event, rawBody)) {
            return {
                statusCode: 401,
                body: "Invalid request signature",
            };
        }
        const body = JSON.parse(rawBody || "{}");
        // Discord Ping verification
        if (body.type === 1) {
            return {
                statusCode: 200,
                headers: jsonHeaders,
                body: JSON.stringify({
                    type: 1,
                }),
            };
        }
        if (body.data?.name === "strava") {
            const discordUserId = body.member.user.id;
            const clientId = process.env.STRAVA_CLIENT_ID;
            if (!clientId) {
                return {
                    statusCode: 200,
                    headers: jsonHeaders,
                    body: JSON.stringify({
                        type: 4,
                        data: {
                            content: "Strava is not configured yet.",
                        },
                    }),
                };
            }
            const redirect = "https://2i877vt1l9.execute-api.ap-southeast-1.amazonaws.com/strava/callback";
            const url = new URL("https://www.strava.com/oauth/authorize");
            url.searchParams.set("client_id", clientId);
            url.searchParams.set("response_type", "code");
            url.searchParams.set("redirect_uri", redirect);
            url.searchParams.set("approval_prompt", "force");
            url.searchParams.set("scope", "activity:read_all");
            url.searchParams.set("state", discordUserId);
            return {
                statusCode: 200,
                headers: jsonHeaders,
                body: JSON.stringify({
                    type: 4,
                    data: {
                        content: `Connect Strava:\n${url.toString()}`,
                    },
                }),
            };
        }
        return {
            statusCode: 200,
            headers: jsonHeaders,
            body: JSON.stringify({
                type: 4,
                data: {
                    content: "✅ System online",
                },
            }),
        };
    }
    return {
        statusCode: 404,
        body: "Not Found",
    };
};
exports.handler = handler;
