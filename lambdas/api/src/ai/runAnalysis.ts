import { formatDistanceKmWith2Decimals, formatPacePerKmWithSpace } from "../stravaFormatting";
import { callDeepSeek } from "./deepseek";
import type { AnalysisInput, StravaActivityContext } from "./types";

const formatRunForAnalysis = (run: StravaActivityContext, index?: number) => {
  const prefix = typeof index === "number" ? `${index + 1}. ` : "- ";
  return [
    `${prefix}${run.name ?? "Unnamed run"}`,
    run.start_date ? `  Date: ${run.start_date}` : undefined,
    run.sport_type || run.type ? `  Type: ${run.sport_type ?? run.type}` : undefined,
    `  Distance: ${formatDistanceKmWith2Decimals(run.distance)}`,
    `  Moving time: ${run.moving_time != null ? `${run.moving_time}s` : "n/a"}`,
    `  Pace: ${formatPacePerKmWithSpace(run.moving_time, run.distance)}`,
    run.pr_count != null ? `  PRs: ${run.pr_count}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildAnalysisPrompt = (input: AnalysisInput) => {
  const latestRun = input.latestRun ?? {
    name: input.activityName,
    type: input.activityType,
    distance: input.distanceMeters,
    moving_time: input.movingTimeSeconds,
    elapsed_time: input.elapsedTimeSeconds,
  };

  const recentRuns = input.recentRuns ?? [];
  const historicalRuns = input.historicalRuns ?? [];

  return [
    "You are a concise running coach.",
    "Write a coaching report in markdown with these sections exactly:",
    "Summary",
    "Trend",
    "Risks",
    "Next Steps",
    "Use the latest run plus recent and historical context.",
    "Keep it specific, practical, and grounded in the data.",
    `Athlete: ${input.athleteName ?? "unknown"}`,
    "",
    "Latest run:",
    formatRunForAnalysis(latestRun),
    "",
    "Recent runs:",
    recentRuns.length > 0 ? recentRuns.map((run, index) => formatRunForAnalysis(run, index)).join("\n\n") : "None available",
    "",
    "Historical runs:",
    historicalRuns.length > 0 ? historicalRuns.map((run, index) => formatRunForAnalysis(run, index)).join("\n\n") : "None available",
    "",
    "Weekly summary:",
    `Distance: ${formatDistanceKmWith2Decimals(input.weeklySummary?.distanceMeters)}`,
    `Runs: ${input.weeklySummary?.runCount ?? "n/a"}`,
    `Moving time: ${input.weeklySummary?.movingTimeSeconds != null ? `${input.weeklySummary.movingTimeSeconds}s` : "n/a"}`,
    `Elapsed time: ${input.weeklySummary?.elapsedTimeSeconds != null ? `${input.weeklySummary.elapsedTimeSeconds}s` : "n/a"}`,
    `Longest run: ${formatDistanceKmWith2Decimals(input.weeklySummary?.longestRunMeters)}`,
  ].join("\n");
};

export const runRunAnalysis = async (input: AnalysisInput) => {
  const msg = await callDeepSeek([
    { role: "user", content: buildAnalysisPrompt(input) },
  ]);
  return msg.content ?? "";
};
