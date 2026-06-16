import type { Message, ToolDefinition } from "./types";

declare const process: {
  env: {
    DEEPSEEK_API_KEY?: string;
    DEEPSEEK_MODEL?: string;
  };
};

export const callDeepSeek = async (
  messages: Message[],
  tools?: ToolDefinition[]
): Promise<Message> => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }

  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      messages,
      ...(tools ? { tools } : {}),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`DeepSeek request failed: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: Message;
    }>;
  };

  return data.choices?.[0]?.message ?? { role: "assistant", content: null };
};
