import type { StravaActivity, StravaUserRecord } from "../stravaApi";

export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
};

export type RunSummary = {
  id?: number;
  name?: string;
  startDate?: string;
  type?: string;
  sportType?: string;
  distanceKm?: number;
  movingTimeSeconds?: number;
  elapsedTimeSeconds?: number;
  pacePerKm?: string;
  duration?: string;
  prCount?: number;
  totalElevationGain?: number;
};

export type WeeklyStatsSummary = {
  distanceKm: number;
  runCount: number;
  movingTimeSeconds: number;
  elapsedTimeSeconds: number;
  longestRunKm: number;
  averagePacePerKm: string;
};

export type RunComparisonSummary = {
  latestRun?: RunSummary;
  baselineRuns: RunSummary[];
  latestPacePerKm?: string;
  baselineAveragePacePerKm?: string;
  paceDeltaSecondsPerKm?: number;
  latestDistanceKm?: number;
  baselineAverageDistanceKm?: number;
  note?: string;
};

export type AgentContext = {
  discordUserId: string;
  linkedStravaUser?: StravaUserRecord;
  cachedActivities?: StravaActivity[];
};

export type ConversationEntry = { role: "user" | "assistant"; content: string };

export type StravaActivityContext = {
  id?: number;
  name?: string;
  sport_type?: string;
  type?: string;
  start_date?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  pr_count?: number;
};

export type WeeklySummary = {
  distanceMeters?: number;
  runCount?: number;
  movingTimeSeconds?: number;
  elapsedTimeSeconds?: number;
  longestRunMeters?: number;
};

export type AnalysisInput = {
  athleteName?: string;
  latestRun?: StravaActivityContext;
  recentRuns?: StravaActivityContext[];
  historicalRuns?: StravaActivityContext[];
  weeklySummary?: WeeklySummary;
  activityName?: string;
  activityType?: string;
  distanceMeters?: number;
  movingTimeSeconds?: number;
  elapsedTimeSeconds?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  averageSpeedMetersPerSecond?: number;
  description?: string;
  notes?: string;
};
