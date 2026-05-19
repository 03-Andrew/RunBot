"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const handler = async () => ({
    statusCode: 200,
    body: JSON.stringify({
        status: "ok"
    })
});
exports.handler = handler;
