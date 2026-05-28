"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postDiscordInteractionFollowUp = void 0;
const postDiscordInteractionFollowUp = async (interactionToken, content) => {
    if (!process.env.DISCORD_APPLICATION_ID) {
        throw new Error("Discord application id is not configured.");
    }
    return fetch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_APPLICATION_ID}/${interactionToken}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
    });
};
exports.postDiscordInteractionFollowUp = postDiscordInteractionFollowUp;
