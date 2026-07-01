import {
  getLinkedStravaUserByDiscordId,
  getStoredStravaActivitiesByDiscordId,
} from "../stravaApi";
import { callDeepSeek } from "./deepseek";
import { loadConversation, MAX_CONVERSATION_TURNS, saveConversation } from "./conversation";
import { TOOL_DEFINITIONS, executeTool } from "./tools";
import type { AgentContext, ConversationEntry, Message } from "./types";
import { type Logger, noopLogger } from "../logger";

const MAX_TOOL_CALLS = 4;

const buildSystemInstruction = (hasLinkedStrava: boolean) =>
  [
    "You are RunBot, a concise conversational running coach inside Discord.",
    "Respond in clear markdown.",
    "Use tools when the user's question needs current, recent, or comparative Strava data.",
    "If a linked Strava account is available, you may reference the user's recent runs, weekly trends, or all-time personal records.",
    hasLinkedStrava
      ? "A linked Strava account is available for this user."
      : "No linked Strava account is available. Do not claim to know the user's personal run data. If the user asks about their own runs, tell them to connect Strava with /strava first.",
    "Keep answers concise and practical.",
    "When the user asks for analysis, pace, trend, or comparison, be specific about what the data supports.",
  ].join("\n");

export const runNaturalLanguageAi = async (
  prompt: string,
  discordUserId: string,
  log: Logger = noopLogger
) => {
  const [linkedStravaUser, pastConversation] = await Promise.all([
    getLinkedStravaUserByDiscordId(discordUserId, log),
    loadConversation(discordUserId),
  ]);
  const hasStrava = Boolean(linkedStravaUser);

  const context: AgentContext = {
    discordUserId,
    linkedStravaUser,
    log,
  };
  if (hasStrava) {
    context.cachedActivities = await getStoredStravaActivitiesByDiscordId(discordUserId);
  }

  const messages: Message[] = [
    { role: "system", content: buildSystemInstruction(hasStrava) },
    ...pastConversation.map((entry) => ({
      role: entry.role as "user" | "assistant",
      content: entry.content,
    })),
    { role: "user" as const, content: prompt },
  ];

  let finalText = "";

  for (let iteration = 0; iteration < MAX_TOOL_CALLS; iteration += 1) {
    const msg = await callDeepSeek(messages, TOOL_DEFINITIONS, log);

    const toolCalls = msg.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const response = msg.content || finalText || "Could not generate a response right now.";

      log.info("AI chat completed", {
        iterations: iteration,
        responseLength: response.length,
      });

      const updated: ConversationEntry[] = [
        ...pastConversation,
        { role: "user" as const, content: prompt },
        { role: "assistant" as const, content: response },
      ].slice(-MAX_CONVERSATION_TURNS * 2);

      await saveConversation(discordUserId, updated);

      return response;
    }

    const toolNames = toolCalls.map((c) => c.function.name);
    log.info("AI tool call iteration", { iteration, toolCount: toolCalls.length, tools: toolNames });

    messages.push(msg);

    const toolResults = await Promise.all(
      toolCalls.map(async (call) => ({
        role: "tool" as const,
        tool_call_id: call.id,
        content: JSON.stringify(await executeTool(context, call)),
      }))
    );

    messages.push(...toolResults);

    finalText = msg.content ?? finalText;
  }

  log.warn("AI chat hit max tool call iterations", { maxIterations: MAX_TOOL_CALLS });
  return finalText || "I could not finish the request in time.";
};
