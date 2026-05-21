import { buildStravaAuthorizeUrl, isValidDiscordRequest } from "../discord";
import {
  fetchLatestStravaActivity,
  getLinkedStravaUserByDiscordId,
  type StravaUserRecord,
} from "../stravaApi";
import { buildStravaActivityMessage } from "../stravaActivityMessage";
import { getRawBody } from "../requestUtils";
import { jsonResponse } from "../http";

declare const process: {
  env: {
    STRAVA_CLIENT_ID?: string;
  };
};

export const handleDiscordInteractions = async (event: {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
  member?: { user?: { id?: string } };
  user?: { id?: string };
}) => {
  const rawBody = getRawBody(event);

  if (!isValidDiscordRequest(event, rawBody)) {
    return {
      statusCode: 401,
      body: "Invalid request signature",
    };
  }

  const body = JSON.parse(rawBody || "{}");

  if (body.type === 1) {
    return jsonResponse(200, { type: 1 });
  }

  if (body.data?.name === "strava") {
    const discordUserId = body.member?.user?.id ?? body.user?.id;

    if (!discordUserId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not identify your Discord user.",
        },
      });
    }

    const clientId = process.env.STRAVA_CLIENT_ID;

    if (!clientId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Strava is not configured yet.",
        },
      });
    }

    return jsonResponse(200, {
      type: 4,
      data: {
        content: `Connect Strava:\n${buildStravaAuthorizeUrl(discordUserId, clientId)}`,
      },
    });
  }

  if (body.data?.name === "get-latest") {
    const discordUserId = body.member?.user?.id ?? body.user?.id;

    if (!discordUserId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not identify your Discord user.",
          flags: 64,
        },
      });
    }

    const user = (await getLinkedStravaUserByDiscordId(discordUserId)) as
      | StravaUserRecord
      | undefined;

    if (!user) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "No Strava account is linked yet. Run `/strava` first.",
          flags: 64,
        },
      });
    }

    try {
      const activity = await fetchLatestStravaActivity(user);

      if (!activity) {
        return jsonResponse(200, {
          type: 4,
          data: {
            content: "No recent Strava activity found.",
            flags: 64,
          },
        });
      }

      return jsonResponse(200, {
        type: 4,
        data: {
          content: buildStravaActivityMessage(activity, discordUserId),
          flags: 64,
        },
      });
    } catch (error) {
      console.error("Failed to fetch latest Strava activity", {
        discordUserId,
        error,
      });

      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not load your latest Strava activity right now.",
          flags: 64,
        },
      });
    }
  }

  return jsonResponse(200, {
    type: 4,
    data: {
      content: "✅ System online",
    },
  });
};
