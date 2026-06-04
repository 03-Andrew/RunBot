import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "../storage";
import {
  fetchStravaActivity,
  fetchStravaActivitiesSince,
  getClubActivitiesById,
  getClubById,
  getLinkedStravaUserByDiscordId,
  getStoredStravaActivitiesByDiscordId,
  type StravaActivity,
  type StravaUserRecord,
} from "../stravaApi";
import {
  isStravaWebhookJob,
  type StravaWebhookJob,
  isDiscordSlashCommandJob,
  type DiscordSlashCommandJob,
  isStravaBackfillJob,
  type StravaBackfillJob,
} from "../types";
import {
  buildClubActivitiesMessageForClub,
  buildStravaActivityMessage,
  calculateWeeklyStats,
  buildWeeklyStatsMessage,
  getCurrentWeekStartUnixSeconds,
} from "../stravaFormatting";
import { postDiscordInteractionFollowUp } from "../discord";

declare const process: {
  env: {
    DISCORD_BOT_TOKEN?: string;
    DISCORD_CHANNEL_ID?: string;
    AI_COACH_URL?: string;
    AI_COACH_TOKEN?: string;
  };
};

const DEFAULT_CLUB_ID = "1600752";
const RECENT_LOOKBACK_DAYS = 30;

const postDiscordMessage = async (content: string) => {
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CHANNEL_ID) {
    throw new Error("Discord notification is not configured.");
  }

  return fetch(
    `https://discord.com/api/v10/channels/${process.env.DISCORD_CHANNEL_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    }
  );
};

const isRunningActivity = (activity: StravaActivity) => {
  const labels = [activity.type, activity.sport_type].filter(
    (label): label is string => typeof label === "string"
  );

  return labels.some((label) => /run/i.test(label));
};

const getActivityTimestamp = (activity: StravaActivity & { UpdatedAt?: string }) => {
  if (activity.start_date) {
    const startedAt = new Date(activity.start_date).getTime();
    if (!Number.isNaN(startedAt)) {
      return startedAt;
    }
  }

  if (activity.UpdatedAt) {
    const updatedAt = new Date(activity.UpdatedAt).getTime();
    if (!Number.isNaN(updatedAt)) {
      return updatedAt;
    }
  }

  return 0;
};

const dedupeAndSortRuns = (
  activities: Array<StravaActivity & { UpdatedAt?: string }>
) => {
  const deduped = new Map<number, StravaActivity & { UpdatedAt?: string }>();

  for (const activity of activities) {
    if (typeof activity.id !== "number") {
      continue;
    }

    if (!isRunningActivity(activity)) {
      continue;
    }

    const existing = deduped.get(activity.id);
    if (!existing || getActivityTimestamp(activity) > getActivityTimestamp(existing)) {
      deduped.set(activity.id, activity);
    }
  }

  return [...deduped.values()].sort(
    (a, b) => getActivityTimestamp(b) - getActivityTimestamp(a)
  );
};

const callAiCoach = async (payload: unknown) => {
  if (!process.env.AI_COACH_URL) {
    throw new Error("AI coach endpoint is not configured.");
  }

  const response = await fetch(process.env.AI_COACH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-runbot-ai-token": process.env.AI_COACH_TOKEN ?? "",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`AI coach failed: ${response.status} ${errorBody}`);
  }

  const data = (await response.json()) as { analysis?: string };
  return data.analysis ?? "";
};

const recalculatePersonalRecords = async (discordUserId: string, allActivities: StravaActivity[]) => {
  console.log(`Recalculating personal records for user ${discordUserId}`);
  const prs: Record<string, StravaActivity | undefined> = {};
  const runs = allActivities.filter(isRunningActivity);
  
  if (runs.length === 0) {
    console.log(`No running activities found to compute PRs for user ${discordUserId}`);
    return;
  }

  let longestRun = runs[0];
  let biggestClimb = runs[0];
  let best5k: StravaActivity | undefined;
  let best5kPace = Infinity;
  let best10k: StravaActivity | undefined;
  let best10kPace = Infinity;
  let bestHalf: StravaActivity | undefined;
  let bestHalfPace = Infinity;

  for (const run of runs) {
    const distM = run.distance ?? 0;
    const timeS = run.moving_time ?? 0;
    const climbM = run.total_elevation_gain ?? 0;

    if (distM > (longestRun.distance ?? 0)) {
      longestRun = run;
    }
    if (climbM > (biggestClimb.total_elevation_gain ?? 0)) {
      biggestClimb = run;
    }

    if (timeS > 0 && distM > 0) {
      const paceSeconds = timeS / (distM / 1000);
      if (distM >= 4900 && paceSeconds < best5kPace) {
        best5kPace = paceSeconds;
        best5k = run;
      }
      if (distM >= 9900 && paceSeconds < best10kPace) {
        best10kPace = paceSeconds;
        best10k = run;
      }
      if (distM >= 20900 && paceSeconds < bestHalfPace) {
        bestHalfPace = paceSeconds;
        bestHalf = run;
      }
    }
  }

  prs.longestRun = longestRun;
  prs.biggestClimb = biggestClimb;
  prs.best5k = best5k;
  prs.best10k = best10k;
  prs.bestHalfMarathon = bestHalf;

  await db.send(
    new PutCommand({
      TableName: "ActivityBot",
      Item: {
        PK: `USER#${discordUserId}`,
        SK: "PERSONAL_RECORDS",
        DiscordID: discordUserId,
        UpdatedAt: new Date().toISOString(),
        personalRecords: prs,
      },
    })
  );
  console.log(`Successfully saved pre-computed PRs for user ${discordUserId}`);
};

const updatePersonalRecordsRecord = async (discordUserId: string, newActivity: StravaActivity) => {
  console.log(`Checking PR updates for user ${discordUserId} with new run ${newActivity.id}`);
  
  const result = await db.send(
    new GetCommand({
      TableName: "ActivityBot",
      Key: {
        PK: `USER#${discordUserId}`,
        SK: "PERSONAL_RECORDS",
      },
    })
  );
  
  const prs = (result.Item?.personalRecords ?? {}) as Record<string, StravaActivity | undefined>;

  let updated = false;

  const currentLongest = prs.longestRun;
  if (!currentLongest || (newActivity.distance ?? 0) > (currentLongest.distance ?? 0)) {
    prs.longestRun = newActivity;
    updated = true;
  }

  const currentClimb = prs.biggestClimb;
  if (!currentClimb || (newActivity.total_elevation_gain ?? 0) > (currentClimb.total_elevation_gain ?? 0)) {
    prs.biggestClimb = newActivity;
    updated = true;
  }

  const distM = newActivity.distance ?? 0;
  const timeS = newActivity.moving_time ?? 0;

  if (timeS > 0 && distM > 0) {
    const newPaceSeconds = timeS / (distM / 1000);

    if (distM >= 4900) {
      const current5k = prs.best5k;
      const current5kPace = current5k && current5k.moving_time && current5k.distance
        ? current5k.moving_time / (current5k.distance / 1000)
        : Infinity;
      if (newPaceSeconds < current5kPace) {
        prs.best5k = newActivity;
        updated = true;
      }
    }

    if (distM >= 9900) {
      const current10k = prs.best10k;
      const current10kPace = current10k && current10k.moving_time && current10k.distance
        ? current10k.moving_time / (current10k.distance / 1000)
        : Infinity;
      if (newPaceSeconds < current10kPace) {
        prs.best10k = newActivity;
        updated = true;
      }
    }

    if (distM >= 20900) {
      const currentHalf = prs.bestHalfMarathon;
      const currentHalfPace = currentHalf && currentHalf.moving_time && currentHalf.distance
        ? currentHalf.moving_time / (currentHalf.distance / 1000)
        : Infinity;
      if (newPaceSeconds < currentHalfPace) {
        prs.bestHalfMarathon = newActivity;
        updated = true;
      }
    }
  }

  if (updated) {
    await db.send(
      new PutCommand({
        TableName: "ActivityBot",
        Item: {
          PK: `USER#${discordUserId}`,
          SK: "PERSONAL_RECORDS",
          DiscordID: discordUserId,
          UpdatedAt: new Date().toISOString(),
          personalRecords: prs,
        },
      })
    );
    console.log(`Updated pre-computed PRs for user ${discordUserId}`);
  }
};

const handleBackfillJob = async (job: StravaBackfillJob) => {
  const discordUserId = job.discordUserId;
  console.log(`Starting Strava backfill for user ${discordUserId}`);

  const user = await getLinkedStravaUserByDiscordId(discordUserId);
  if (!user) {
    console.error(`Backfill failed: No linked Strava user found for Discord ID ${discordUserId}`);
    return;
  }

  const lookbackDays = job.lookbackDays ?? 90;
  const afterUnixSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;

  try {
    const activities = await fetchStravaActivitiesSince(user, afterUnixSeconds);
    console.log(`Fetched ${activities.length} activities for backfill`);

    for (const activity of activities) {
      if (!activity.id) continue;

      await db.send(
        new PutCommand({
          TableName: "ActivityBot",
          Item: {
            PK: `USER#${discordUserId}`,
            SK: `ACTIVITY#${activity.id}`,
            DiscordID: discordUserId,
            UpdatedAt: new Date().toISOString(),
            ...activity,
          },
        })
      );
    }
    console.log(`Backfill successfully completed for user ${discordUserId}. Saved ${activities.length} activities.`);
    await recalculatePersonalRecords(discordUserId, activities);
  } catch (error: any) {
    console.error(`Backfill failed for user ${discordUserId}:`, error.message);
  }
};

const handleWebhookJob = async (job: StravaWebhookJob) => {
  if (job.objectType !== "activity" || !["create", "update"].includes(job.aspectType)) {
    console.log("Ignoring non-notifiable Strava webhook job", job);
    return;
  }

  const result = await db.send(
    new QueryCommand({
      TableName: "ActivityBot",
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `STRAVA#${job.ownerId}`,
      },
    })
  );

  const user = result.Items?.[0];

  if (!user) {
    console.log("No linked Discord user found for Strava owner", {
      ownerId: job.ownerId,
    });
    return;
  }

  const typedUser = user as StravaUserRecord;
  const discordUserId = user.DiscordID ?? typedUser.PK.replace("USER#", "");
  const activity = await fetchStravaActivity(typedUser, job.activityId);

  await db.send(
    new PutCommand({
      TableName: "ActivityBot",
      Item: {
        PK: `USER#${discordUserId}`,
        SK: `ACTIVITY#${activity.id}`,
        DiscordID: discordUserId,
        UpdatedAt: new Date().toISOString(),
        ...activity,
      },
    })
  );

  if (isRunningActivity(activity)) {
    try {
      await updatePersonalRecordsRecord(discordUserId, activity);
    } catch (err: any) {
      console.error("Failed to update personal records:", err.message);
    }
  }

  const discordResponse = await postDiscordMessage(
    buildStravaActivityMessage(activity, discordUserId)
  );

  if (!discordResponse.ok) {
    const errorBody = await discordResponse.text();
    throw new Error(
      `Discord message failed: ${discordResponse.status} ${errorBody}`
    );
  }

  console.log("Discord message sent for Strava activity", {
    ownerId: job.ownerId,
    activityId: job.activityId,
  });
};

const handleDiscordSlashCommandJob = async (job: DiscordSlashCommandJob) => {
  const user = await getLinkedStravaUserByDiscordId(job.discordUserId);

  if (!user && job.commandName !== "ai-chat") {
    const response = await postDiscordInteractionFollowUp(
      job.interactionToken,
      "No Strava account is linked yet. Run `/strava` first."
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Discord follow-up failed: ${response.status} ${errorBody}`
      );
    }

    return;
  }

  const linkedUser = user as NonNullable<typeof user>;

  try {
    if (job.commandName === "ai-chat") {
      const analysis = await callAiCoach({
        prompt: job.prompt ?? "",
        discordUserId: job.discordUserId,
      });

      const response = await postDiscordInteractionFollowUp(
        job.interactionToken,
        analysis || "Could not generate a response right now."
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Discord follow-up failed: ${response.status} ${errorBody}`
        );
      }

      return;
    }

    if (job.commandName === "stats") {
      const afterUnixSeconds = getCurrentWeekStartUnixSeconds();
      const activities = await fetchStravaActivitiesSince(linkedUser, afterUnixSeconds);
      const response = await postDiscordInteractionFollowUp(
        job.interactionToken,
        buildWeeklyStatsMessage(activities)
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Discord follow-up failed: ${response.status} ${errorBody}`
        );
      }

      return;
    }

    if (job.commandName === "analyse-run") {
      const lookbackSince = Math.floor(Date.now() / 1000) - RECENT_LOOKBACK_DAYS * 24 * 60 * 60;
      const [recentActivities, storedActivities] = await Promise.all([
        fetchStravaActivitiesSince(linkedUser, lookbackSince),
        getStoredStravaActivitiesByDiscordId(job.discordUserId),
      ]);

      const allRuns = dedupeAndSortRuns([...recentActivities, ...storedActivities]);
      const recentRuns = allRuns.slice(0, 5);
      const historicalRuns = allRuns.slice(5, 15);
      const latestRun = recentRuns[0] ?? historicalRuns[0];
      const weeklySummary = calculateWeeklyStats(recentActivities);

      if (!latestRun) {
        const response = await postDiscordInteractionFollowUp(
          job.interactionToken,
          "I could not find enough run history to analyse yet."
        );

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `Discord follow-up failed: ${response.status} ${errorBody}`
          );
        }

        return;
      }

      const analysis = await callAiCoach({
        athleteName: "unknown",
        latestRun,
        recentRuns,
        historicalRuns,
        weeklySummary,
      });

      const response = await postDiscordInteractionFollowUp(
        job.interactionToken,
        analysis || "Could not generate a run analysis right now."
      );

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Discord follow-up failed: ${response.status} ${errorBody}`
        );
      }

      return;
    }

    const club = await getClubById(linkedUser, DEFAULT_CLUB_ID);
    const activities = await getClubActivitiesById(linkedUser, DEFAULT_CLUB_ID, 1, 30);
    const response = await postDiscordInteractionFollowUp(
      job.interactionToken,
      buildClubActivitiesMessageForClub(
        activities,
        club.name ?? "",
        DEFAULT_CLUB_ID
      )
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Discord follow-up failed: ${response.status} ${errorBody}`
      );
    }
  } catch (error) {
    console.error("Failed to process Discord slash command", {
      commandName: job.commandName,
      discordUserId: job.discordUserId,
      error,
    });

    const response = await postDiscordInteractionFollowUp(
      job.interactionToken,
      job.commandName === "stats"
        ? "Could not load your weekly Strava stats right now."
        : "Could not load club activities right now."
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Discord follow-up failed: ${response.status} ${errorBody}`
      );
    }
  }
};

export const handleProcessStravaWebhook = async (event: {
  Records?: Array<{ body?: string }>;
}) => {
  for (const record of event.Records ?? []) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(record.body ?? "{}");
    } catch (error) {
      throw new Error(`Invalid SQS message body: ${String(error)}`);
    }

    if (isStravaWebhookJob(parsed)) {
      await handleWebhookJob(parsed);
      continue;
    }

    if (isStravaBackfillJob(parsed)) {
      await handleBackfillJob(parsed);
      continue;
    }

    if (isDiscordSlashCommandJob(parsed)) {
      await handleDiscordSlashCommandJob(parsed);
      continue;
    }

    throw new Error("Invalid queue job");
  }
};
