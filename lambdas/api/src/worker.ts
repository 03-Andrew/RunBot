import { handleProcessStravaWebhook } from "./handlers/processStravaWebhook";
import { createLogger } from "./logger";

export const handler = async (event: any, context?: any) => {
  const traceId =
    context?.awsRequestId ??
    event?.Records?.[0]?.messageId ??
    `sqs-${Date.now()}`;
  const log = createLogger(traceId);
  await handleProcessStravaWebhook(event, log);
};
