"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleHealth = void 0;
const http_1 = require("../http");
const handleHealth = () => (0, http_1.jsonResponse)(200, { status: "ok" });
exports.handleHealth = handleHealth;
