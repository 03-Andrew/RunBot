import { buildStravaAuthorizeUrl, isValidDiscordRequest } from "../discord";
import { getRawBody, jsonResponse } from "../http";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "../storage";
import type { DiscordSlashCommandJob } from "../types";

const sqs = new SQSClient({});

declare const process: {
  env: {
    STRAVA_CLIENT_ID?: string;
    SQS_QUEUE_URL?: string;
  };
};

const getSubcommandName = (
  options: Array<{ name?: string; type?: number }> | undefined
) => options?.find((option) => option?.type === 1)?.name;

const getStringOptionValue = (
  options: Array<{ name?: string; type?: number; value?: unknown }> | undefined,
  name: string
) => {
  const option = options?.find((entry) => entry?.name === name && entry?.type === 3);
  return typeof option?.value === "string" ? option.value : undefined;
};

const LIMIT_MAX_TOKENS = 5;
const LIMIT_REFILL_RATE_SECONDS = 30; // 1 token refilled every 30 seconds

const checkRateLimit = async (discordUserId: string): Promise<{ allowed: boolean; waitSeconds: number }> => {
  try {
    const result = await db.send(
      new GetCommand({
        TableName: "ActivityBot",
        Key: {
          PK: `USER#${discordUserId}`,
          SK: "RATE_LIMIT",
        },
      })
    );

    const now = Math.floor(Date.now() / 1000);
    let tokens = LIMIT_MAX_TOKENS;
    let lastRefill = now;

    if (result.Item) {
      tokens = result.Item.tokens ?? LIMIT_MAX_TOKENS;
      lastRefill = result.Item.lastRefill ?? now;

      const elapsed = now - lastRefill;
      if (elapsed > 0) {
        const refilledTokens = Math.floor(elapsed / LIMIT_REFILL_RATE_SECONDS);
        if (refilledTokens > 0) {
          tokens = Math.min(LIMIT_MAX_TOKENS, tokens + refilledTokens);
          lastRefill = lastRefill + refilledTokens * LIMIT_REFILL_RATE_SECONDS;
        }
      }
    }

    if (tokens >= 1) {
      tokens -= 1;
      await db.send(
        new PutCommand({
          TableName: "ActivityBot",
          Item: {
            PK: `USER#${discordUserId}`,
            SK: "RATE_LIMIT",
            tokens,
            lastRefill,
            UpdatedAt: new Date().toISOString(),
          },
        })
      );
      return { allowed: true, waitSeconds: 0 };
    }

    const waitSeconds = LIMIT_REFILL_RATE_SECONDS - (now - lastRefill);
    return { allowed: false, waitSeconds };
  } catch (error: any) {
    console.error("Rate limit check failed, defaulting to allowed:", error.message);
    return { allowed: true, waitSeconds: 0 };
  }
};

export const handleDiscordInteractions = async (event: {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  member?: { user?: { id?: string } };
  user?: { id?: string };
}) => {
  const rawBody = getRawBody(event);

  if (!isValidDiscordRequest(event, rawBody)) {
    return {
      statusCode: 401,
      body: "Invalid request signature",
    };
  }

  const body = JSON.parse(rawBody || "{}");

  const helpMessage = [
    "**Available commands**",
    "`/health` - Check bot health",
    "`/strava` - Connect your Strava account",
    "`/stats` - Queue your weekly Strava stats",
    "`/club-activities` - Queue recent activities from the default Strava club",
    "`/analyse run` - Queue an AI review of your latest run and training trend",
    "`/ai <prompt>` - Chat with the AI coach using natural language",
    "`/help` - Show this message",
  ].join("\n");

  if (body.type === 1) {
    return jsonResponse(200, { type: 1 });
  }

  // Global Rate Limiting for intensive slash commands
  const discordUserId = body.member?.user?.id ?? body.user?.id;
  const commandName = body.data?.name;
  if (discordUserId && ["stats", "club-activities", "analyse", "ai"].includes(commandName)) {
    try {
      const { allowed, waitSeconds } = await checkRateLimit(discordUserId);
      if (!allowed) {
        return jsonResponse(200, {
          type: 4,
          data: {
            content: `⚠️ **Rate Limited!** Please wait **${waitSeconds} seconds** before running this command again.`,
            flags: 64, // Ephemeral: only visible to the user who ran the command
          },
        });
      }
    } catch (err: any) {
      console.error("Rate limiting check failed:", err.message);
    }
  }

  if (body.data?.name === "strava") {
    const discordUserId = body.member?.user?.id ?? body.user?.id;

    if (!discordUserId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not identify your Discord user.",
        },
      });
    }

    const clientId = process.env.STRAVA_CLIENT_ID;

    if (!clientId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Strava is not configured yet.",
        },
      });
    }

    return jsonResponse(200, {
      type: 4,
      data: {
        content: `Connect Strava:\n${buildStravaAuthorizeUrl(discordUserId, clientId)}`,
      },
    });
  }

  if (body.data?.name === "help") {
    return jsonResponse(200, {
      type: 4,
      data: {
        content: helpMessage,
        // flags: 64,
      },
    });
  }

  if (body.data?.name === "ai") {
    const discordUserId = body.member?.user?.id ?? body.user?.id;
    const prompt = getStringOptionValue(body.data?.options, "prompt")?.trim();

    if (!discordUserId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not identify your Discord user.",
        },
      });
    }

    if (!prompt) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Please provide a prompt for `/ai`.",
        },
      });
    }

    const queueUrl = process.env.SQS_QUEUE_URL;
    if (!queueUrl) {
      console.error("SQS queue is not configured");
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Queue is not configured yet.",
        },
      });
    }

    const message: DiscordSlashCommandJob = {
      kind: "discord-slash-command",
      commandName: "ai-chat",
      interactionToken: body.token,
      discordUserId,
      prompt,
    };

    try {
      const response = await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
        })
      );

      console.log("Queued Discord slash command job", {
        commandName: "ai-chat",
        discordUserId,
        messageId: response.MessageId,
      });

      return jsonResponse(200, {
        type: 5,
      });
    } catch (error) {
      console.error("Failed to queue Discord slash command job", {
        commandName: "ai-chat",
        discordUserId,
        error,
      });

      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not queue your AI request right now.",
        },
      });
    }
  }

  if (body.data?.name === "stats") {
    const discordUserId = body.member?.user?.id ?? body.user?.id;

    if (!discordUserId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not identify your Discord user.",
        },
      });
    }

    const queueUrl = process.env.SQS_QUEUE_URL;
    if (!queueUrl) {
      console.error("SQS queue is not configured");
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Queue is not configured yet.",
        },
      });
    }

    const message: DiscordSlashCommandJob = {
      kind: "discord-slash-command",
      commandName: "stats",
      interactionToken: body.token,
      discordUserId,
    };

    try {
      const response = await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
        })
      );

      console.log("Queued Discord slash command job", {
        commandName: "stats",
        discordUserId,
        messageId: response.MessageId,
      });

      return jsonResponse(200, {
        type: 5,
      });
    } catch (error) {
      console.error("Failed to queue Discord slash command job", {
        commandName: "stats",
        discordUserId,
        error,
      });

      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not queue your stats request right now.",
        },
      });
    }
  }

  if (body.data?.name === "analyse" && getSubcommandName(body.data?.options) === "run") {
    const discordUserId = body.member?.user?.id ?? body.user?.id;

    if (!discordUserId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not identify your Discord user.",
        },
      });
    }

    const queueUrl = process.env.SQS_QUEUE_URL;
    if (!queueUrl) {
      console.error("SQS queue is not configured");
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Queue is not configured yet.",
        },
      });
    }

    const message: DiscordSlashCommandJob = {
      kind: "discord-slash-command",
      commandName: "analyse-run",
      interactionToken: body.token,
      discordUserId,
    };

    try {
      const response = await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
        })
      );

      console.log("Queued Discord slash command job", {
        commandName: "analyse-run",
        discordUserId,
        messageId: response.MessageId,
      });

      return jsonResponse(200, {
        type: 5,
      });
    } catch (error) {
      console.error("Failed to queue Discord slash command job", {
        commandName: "analyse-run",
        discordUserId,
        error,
      });

      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not queue your analysis request right now.",
        },
      });
    }
  }

  if (body.data?.name === "club-activities") {
    const discordUserId = body.member?.user?.id ?? body.user?.id;

    if (!discordUserId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not identify your Discord user.",
        },
      });
    }

    const queueUrl = process.env.SQS_QUEUE_URL;
    if (!queueUrl) {
      console.error("SQS queue is not configured");
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Queue is not configured yet.",
        },
      });
    }

    const message: DiscordSlashCommandJob = {
      kind: "discord-slash-command",
      commandName: "club-activities",
      interactionToken: body.token,
      discordUserId,
    };

    try {
      const response = await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
        })
      );

      console.log("Queued Discord slash command job", {
        commandName: "club-activities",
        discordUserId,
        messageId: response.MessageId,
      });

      return jsonResponse(200, {
        type: 5,
      });
    } catch (error) {
      console.error("Failed to queue Discord slash command job", {
        commandName: "club-activities",
        discordUserId,
        error,
      });

      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not queue your club request right now.",
        },
      });
    }
  }

  return jsonResponse(200, {
    type: 4,
    data: {
      content: "✅ System online",
    },
  });
};
