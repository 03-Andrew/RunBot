import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "../storage";
import type { ConversationEntry } from "./types";

export const MAX_CONVERSATION_TURNS = 10;

export const loadConversation = async (discordUserId: string): Promise<ConversationEntry[]> => {
  const result = await db.send(
    new GetCommand({
      TableName: "ActivityBot",
      Key: { PK: `USER#${discordUserId}`, SK: "CONVERSATION" },
    })
  );
  return (result.Item?.messages as ConversationEntry[]) ?? [];
};

export const saveConversation = async (
  discordUserId: string,
  entries: ConversationEntry[]
) => {
  await db.send(
    new PutCommand({
      TableName: "ActivityBot",
      Item: {
        PK: `USER#${discordUserId}`,
        SK: "CONVERSATION",
        DiscordID: discordUserId,
        UpdatedAt: new Date().toISOString(),
        messages: entries,
      },
    })
  );
};
