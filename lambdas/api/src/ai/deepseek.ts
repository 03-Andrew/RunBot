import type { Message, ToolDefinition } from "./types";
import { type Logger, noopLogger } from "../logger";

declare const process: {
  env: {
    DEEPSEEK_API_KEY?: string;
    DEEPSEEK_MODEL?: string;
  };
};

export const callDeepSeek = async (
  messages: Message[],
  tools?: ToolDefinition[],
  log: Logger = noopLogger
): Promise<Message> => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }

  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  log.debug("Calling DeepSeek API", {
    model,
    messageCount: messages.length,
    toolCount: tools?.length ?? 0,
  });

  const startedAt = Date.now();

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      ...(tools ? { tools } : {}),
    }),
  });

  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const errorBody = await response.text();
    log.error("DeepSeek request failed", { status: response.status, durationMs });
    throw new Error(`DeepSeek request failed: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: Message;
    }>;
  };

  const msg = data.choices?.[0]?.message ?? { role: "assistant", content: null };
  log.debug("DeepSeek response received", {
    durationMs,
    choiceCount: data.choices?.length ?? 0,
    hasToolCalls: Boolean(msg.tool_calls?.length),
    contentLength: msg.content?.length ?? 0,
  });

  return msg;
};
