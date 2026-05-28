"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});
const getRawBody = (event) => {
    const body = event.body ?? "";
    return event.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
};
const getHeader = (headers, name) => {
    if (!headers) {
        return undefined;
    }
    return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
};
const formatDistanceKm = (meters) => {
    if (meters == null || Number.isNaN(meters)) {
        return "n/a";
    }
    return `${(meters / 1000).toFixed(2)} km`;
};
const formatPace = (movingTime, distanceMeters) => {
    if (!movingTime || !distanceMeters || distanceMeters <= 0) {
        return "n/a";
    }
    const secondsPerKm = movingTime / (distanceMeters / 1000);
    const minutes = Math.floor(secondsPerKm / 60);
    const seconds = Math.round(secondsPerKm % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")} /km`;
};
const formatRun = (run, index) => {
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
const buildPrompt = (input) => {
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
const handler = async (event) => {
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
    let input;
    try {
        input = JSON.parse(getRawBody(event) || "{}");
    }
    catch {
        return jsonResponse(400, { error: "Invalid JSON body" });
    }
    const prompt = buildPrompt(input);
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL ?? "gemini-2.5-flash"}:generateContent`, {
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
        });
        if (!response.ok) {
            return jsonResponse(500, { error: "Failed to analyze run" });
        }
        const data = (await response.json());
        const analysis = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        return jsonResponse(200, { analysis });
    }
    catch {
        return jsonResponse(500, { error: "Failed to analyze run" });
    }
};
exports.handler = handler;
