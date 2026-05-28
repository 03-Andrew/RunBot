declare const process: {
  env: {
    DISCORD_APPLICATION_ID?: string;
  };
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
