import { handleProcessStravaWebhook } from "./handlers/processStravaWebhook";

export const handler = async (event: any) => {
  await handleProcessStravaWebhook(event);
};
