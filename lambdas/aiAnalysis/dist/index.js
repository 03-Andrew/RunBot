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
const handler = async (event) => {
    const method = event.requestContext?.http?.method;
    const path = event.requestContext?.http?.path;
    if (method === "GET" && path === "/ai/health") {
        return jsonResponse(200, { status: "ok" });
    }
    if (method !== "POST") {
        return jsonResponse(405, { error: "Method not allowed" });
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
    const prompt = [
        "You are a concise running coach.",
        "Return valid JSON with keys: summary, coachingNotes, risks, nextSteps.",
        `Athlete: ${input.athleteName ?? "unknown"}`,
        `Name: ${input.activityName ?? "unknown"}`,
        `Type: ${input.activityType ?? "unknown"}`,
        `DistanceMeters: ${input.distanceMeters ?? "unknown"}`,
        `MovingTimeSeconds: ${input.movingTimeSeconds ?? "unknown"}`,
        `ElapsedTimeSeconds: ${input.elapsedTimeSeconds ?? "unknown"}`,
        `AverageHeartRate: ${input.averageHeartRate ?? "unknown"}`,
        `MaxHeartRate: ${input.maxHeartRate ?? "unknown"}`,
        `AverageSpeedMetersPerSecond: ${input.averageSpeedMetersPerSecond ?? "unknown"}`,
        `Description: ${input.description ?? "none"}`,
        `Notes: ${input.notes ?? "none"}`,
    ].join("\n");
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
                generationConfig: {
                    responseMimeType: "application/json",
                },
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
