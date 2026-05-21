"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.htmlResponse = exports.jsonResponse = exports.textResponse = exports.htmlHeaders = exports.jsonHeaders = void 0;
exports.jsonHeaders = {
    "Content-Type": "application/json",
};
exports.htmlHeaders = {
    "Content-Type": "text/html",
};
const textResponse = (statusCode, body) => ({
    statusCode,
    body,
});
exports.textResponse = textResponse;
const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: exports.jsonHeaders,
    body: JSON.stringify(body),
});
exports.jsonResponse = jsonResponse;
const htmlResponse = (statusCode, body) => ({
    statusCode,
    headers: exports.htmlHeaders,
    body,
});
exports.htmlResponse = htmlResponse;
