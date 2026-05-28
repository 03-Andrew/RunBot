"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDiscordSlashCommandJob = void 0;
const isDiscordSlashCommandJob = (value) => {
    if (!value || typeof value !== "object") {
        return false;
    }
    const job = value;
    return (job.kind === "discord-slash-command" &&
        (job.commandName === "stats" || job.commandName === "club-activities") &&
        typeof job.interactionToken === "string" &&
        job.interactionToken.length > 0 &&
        typeof job.discordUserId === "string" &&
        job.discordUserId.length > 0);
};
exports.isDiscordSlashCommandJob = isDiscordSlashCommandJob;
