"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const processStravaWebhook_1 = require("./handlers/processStravaWebhook");
const handler = async (event) => {
    await (0, processStravaWebhook_1.handleProcessStravaWebhook)(event);
};
exports.handler = handler;
