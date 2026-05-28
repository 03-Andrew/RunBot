export type DiscordSlashCommandJob = {
  kind: "discord-slash-command";
  commandName: "stats" | "club-activities" | "analyse-run";
  interactionToken: string;
  discordUserId: string;
};

export const isDiscordSlashCommandJob = (
  value: unknown
): value is DiscordSlashCommandJob => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const job = value as Partial<DiscordSlashCommandJob>;

  return (
    job.kind === "discord-slash-command" &&
    (job.commandName === "stats" ||
      job.commandName === "club-activities" ||
      job.commandName === "analyse-run") &&
    typeof job.interactionToken === "string" &&
    job.interactionToken.length > 0 &&
    typeof job.discordUserId === "string" &&
    job.discordUserId.length > 0
  );
};
