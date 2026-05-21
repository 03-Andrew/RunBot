import { jsonResponse } from "../http";

export const handleHealth = () => jsonResponse(200, { status: "ok" });

