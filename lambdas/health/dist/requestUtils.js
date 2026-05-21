"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRawBody = exports.getHeader = void 0;
const getHeader = (headers, name) => {
    if (!headers) {
        return undefined;
    }
    return (headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]);
};
exports.getHeader = getHeader;
const getRawBody = (event) => {
    const body = event.body ?? "";
    if (event.isBase64Encoded) {
        return Buffer.from(body, "base64").toString("utf8");
    }
    return body;
};
exports.getRawBody = getRawBody;
