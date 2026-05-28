import { buildStravaAuthorizeUrl, isValidDiscordRequest } from "../discord";
import { buildWeeklyStatsMessage, getCurrentWeekStartUnixSeconds } from "../stravaStats";
import { buildClubActivitiesMessageForClub } from "../stravaClubActivitiesMessage";
import { getRawBody } from "../requestUtils";
import { jsonResponse } from "../http";
import {
  getLinkedStravaUserByDiscordId,
  fetchStravaActivitiesSince,
  getClubActivitiesById,
  getClubById,
} from "../stravaApi";

const DEFAULT_CLUB_ID = "1600752";

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

  const helpMessage = [
    "**Available commands**",
    "`/health` - Check bot health",
    "`/strava` - Connect your Strava account",
    "`/stats` - Show your weekly Strava stats",
    "`/club-activities` - List recent activities from a Strava club",
    "`/help` - Show this message",
  ].join("\n");

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

  if (body.data?.name === "help") {
    return jsonResponse(200, {
      type: 4,
      data: {
        content: helpMessage,
        // flags: 64,
      },
    });
  }

  if (body.data?.name === "stats") {
    const discordUserId = body.member?.user?.id ?? body.user?.id;

    if (!discordUserId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not identify your Discord user.",
          // flags: 64,
        },
      });
    }

    const user = await getLinkedStravaUserByDiscordId(discordUserId);

    if (!user) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "No Strava account is linked yet. Run `/strava` first.",
          // flags: 64,
        },
      });
    }

    try {
      const afterUnixSeconds = getCurrentWeekStartUnixSeconds();
      const activities = await fetchStravaActivitiesSince(user, afterUnixSeconds);

      return jsonResponse(200, {
        type: 4,
        data: {
          content: buildWeeklyStatsMessage(activities),
          // flags: 64,
        },
      });
    } catch (error) {
      console.error("Failed to fetch weekly Strava stats", {
        discordUserId,
        error,
      });

      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not load your weekly Strava stats right now.",
          // flags: 64,
        },
      });
    }
  }

  if (body.data?.name === "club-activities") {
    const discordUserId = body.member?.user?.id ?? body.user?.id;

    if (!discordUserId) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not identify your Discord user.",
          // flags: 64,
        },
      });
    }

    const user = await getLinkedStravaUserByDiscordId(discordUserId);

    if (!user) {
      return jsonResponse(200, {
        type: 4,
        data: {
          content: "No Strava account is linked yet. Run `/strava` first.",
          // flags: 64,
        },
      });
    }

    try {
      const club = await getClubById(user, DEFAULT_CLUB_ID);
      const activities = await getClubActivitiesById(
        user,
        DEFAULT_CLUB_ID,
        1,
        30
      );

      return jsonResponse(200, {
        type: 4,
        data: {
          content: buildClubActivitiesMessageForClub(
            activities,
            club.name ?? "",
            DEFAULT_CLUB_ID
          ),
          // flags: 64,
        },
      });
    } catch (error) {
      console.error("Failed to fetch club activities", {
        discordUserId,
        clubId: DEFAULT_CLUB_ID,
        error,
      });

      return jsonResponse(200, {
        type: 4,
        data: {
          content: "Could not load club activities right now.",
          // flags: 64,
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
