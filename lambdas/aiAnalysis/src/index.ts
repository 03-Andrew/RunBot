import { runNaturalLanguageAi } from "./agent";

declare const Buffer: any;
declare const process: {
  env: {
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
    AI_COACH_TOKEN?: string;
  };
};

const jsonResponse = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const getRawBody = (event: { body?: string | null; isBase64Encoded?: boolean }) => {
  const body = event.body ?? "";
  return event.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
};

const getHeader = (
  headers: Record<string, string | undefined> | undefined,
  name: string
) => {
  if (!headers) {
    return undefined;
  }

  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
};

type StravaActivityContext = {
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

type WeeklySummary = {
  distanceMeters?: number;
  runCount?: number;
  movingTimeSeconds?: number;
  elapsedTimeSeconds?: number;
  longestRunMeters?: number;
};

type AnalysisInput = {
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

type ChatInput = {
  prompt?: string;
  discordUserId?: string;
};

const formatDistanceKm = (meters?: number) => {
  if (meters == null || Number.isNaN(meters)) {
    return "n/a";
  }

  return `${(meters / 1000).toFixed(2)} km`;
};

const formatPace = (movingTime?: number, distanceMeters?: number) => {
  if (!movingTime || !distanceMeters || distanceMeters <= 0) {
    return "n/a";
  }

  const secondsPerKm = movingTime / (distanceMeters / 1000);
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);

  return `${minutes}:${String(seconds).padStart(2, "0")} /km`;
};

const formatRun = (run: StravaActivityContext, index?: number) => {
  const prefix = typeof index === "number" ? `${index + 1}. ` : "- ";
  return [
    `${prefix}${run.name ?? "Unnamed run"}`,
    run.start_date ? `  Date: ${run.start_date}` : undefined,
    run.sport_type || run.type ? `  Type: ${run.sport_type ?? run.type}` : undefined,
    `  Distance: ${formatDistanceKm(run.distance)}`,
    `  Moving time: ${run.moving_time != null ? `${run.moving_time}s` : "n/a"}`,
    `  Pace: ${formatPace(run.moving_time, run.distance)}`,
    run.pr_count != null ? `  PRs: ${run.pr_count}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildPrompt = (input: AnalysisInput) => {
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
    formatRun(latestRun),
    "",
    "Recent runs:",
    recentRuns.length > 0 ? recentRuns.map((run, index) => formatRun(run, index)).join("\n\n") : "None available",
    "",
    "Historical runs:",
    historicalRuns.length > 0 ? historicalRuns.map((run, index) => formatRun(run, index)).join("\n\n") : "None available",
    "",
    "Weekly summary:",
    `Distance: ${formatDistanceKm(input.weeklySummary?.distanceMeters)}`,
    `Runs: ${input.weeklySummary?.runCount ?? "n/a"}`,
    `Moving time: ${input.weeklySummary?.movingTimeSeconds != null ? `${input.weeklySummary.movingTimeSeconds}s` : "n/a"}`,
    `Elapsed time: ${input.weeklySummary?.elapsedTimeSeconds != null ? `${input.weeklySummary.elapsedTimeSeconds}s` : "n/a"}`,
    `Longest run: ${formatDistanceKm(input.weeklySummary?.longestRunMeters)}`,
  ].join("\n");
};

export const handler = async (event: {
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
  };
}) => {
  const method = event.requestContext?.http?.method;
  const path = event.requestContext?.http?.path;

  if (method === "GET" && path === "/ai/health") {
    return jsonResponse(200, { status: "ok" });
  }

  if (method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const internalToken = process.env.AI_COACH_TOKEN;
  const requestToken = getHeader(event.headers, "x-runbot-ai-token");

  if (!internalToken || requestToken !== internalToken) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse(500, { error: "GEMINI_API_KEY is not configured" });
  }

  let input: AnalysisInput;
  let rawInput: unknown;

  try {
    rawInput = JSON.parse(getRawBody(event) || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (
    rawInput &&
    typeof rawInput === "object" &&
    typeof (rawInput as ChatInput).prompt === "string" &&
    typeof (rawInput as ChatInput).discordUserId === "string"
  ) {
    const chatInput = rawInput as Required<ChatInput>;
    try {
      const analysis = await runNaturalLanguageAi(
        chatInput.prompt,
        chatInput.discordUserId
      );

      return jsonResponse(200, { analysis });
    } catch (error) {
      console.error("AI chat request failed", {
        discordUserId: chatInput.discordUserId,
        error,
      });

      return jsonResponse(500, { error: "Failed to generate chat response" });
    }
  }

  input = rawInput as AnalysisInput;
  const prompt = buildPrompt(input);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${
        process.env.GEMINI_MODEL ?? "gemini-2.5-flash"
      }:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      return jsonResponse(500, { error: "Failed to analyze run" });
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };
    const analysis = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return jsonResponse(200, { analysis });
  } catch {
    return jsonResponse(500, { error: "Failed to analyze run" });
  }
};
