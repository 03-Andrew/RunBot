import { ClubActivity } from "./stravaApi";

const formatDistanceKm = (meters?: number) => {
  if (meters == null || Number.isNaN(meters)) {
    return "n/a";
  }

  return `${(meters / 1000).toFixed(1)} km`;
};

const formatDuration = (seconds?: number) => {
  if (seconds == null || Number.isNaN(seconds)) {
    return "n/a";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};

const getAthleteName = (athlete?: ClubActivity["athlete"]) => {
  const firstName = athlete?.firstname?.trim();
  const lastName = athlete?.lastname?.trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return fullName || "Unknown athlete";
};

const getActivityType = (activity: ClubActivity) => activity.sport_type ?? activity.type ?? "Activity";

export const buildClubActivitiesMessage = (activities: ClubActivity[], clubId: string) => {
  if (activities.length === 0) {
    return [`Club activities for ${clubId}`, "No recent activities found."].join("\n");
  }

  return [
    `Club activities for ${clubId}`,
    ...activities.slice(0, 10).map((activity, index) => {
      const athleteName = getAthleteName(activity.athlete);
      const activityType = getActivityType(activity);
      const activityName = activity.name ? ` - ${activity.name}` : "";

      return `${index + 1}. ${athleteName}: ${activityType}${activityName} (${formatDistanceKm(
        activity.distance
      )}, ${formatDuration(activity.moving_time ?? activity.elapsed_time)})`;
    }),
  ].join("\n");
};

export const buildClubActivitiesMessageForClub = (
  activities: ClubActivity[],
  clubName: string,
  clubId: string
) => {
  const heading = clubName.trim().length > 0 ? `Club activities for ${clubName}` : `Club activities for ${clubId}`;

  if (activities.length === 0) {
    return [heading, "No recent activities found."].join("\n");
  }

  return [
    heading,
    ...activities.slice(0, 10).map((activity, index) => {
      const athleteName = getAthleteName(activity.athlete);
      const activityType = getActivityType(activity);
      const activityName = activity.name ? ` - ${activity.name}` : "";

      return `${index + 1}. ${athleteName}: ${activityType}${activityName} (${formatDistanceKm(
        activity.distance
      )}, ${formatDuration(activity.moving_time ?? activity.elapsed_time)})`;
    }),
  ].join("\n");
};
