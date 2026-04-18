import test from "node:test";
import assert from "node:assert/strict";

import { classifyError } from "./graph-states.js";

test("classifyError detects 401/403 as auth", () => {
  assert.equal(classifyError({ status: 401 }), "auth");
  assert.equal(classifyError({ status: 403 }), "auth");
});

test("classifyError detects 404 as not-found", () => {
  assert.equal(classifyError({ status: 404 }), "not-found");
});

test("classifyError detects 429 as rate-limit", () => {
  assert.equal(classifyError({ status: 429 }), "rate-limit");
});

test("classifyError detects 5xx as server", () => {
  assert.equal(classifyError({ status: 500 }), "server");
  assert.equal(classifyError({ status: 503 }), "server");
  assert.equal(classifyError({ status: 599 }), "server");
});

test("classifyError detects TypeError with fetch as network", () => {
  const err = new TypeError("Failed to fetch");
  assert.equal(classifyError(err), "network");
});

test("classifyError detects aborted requests as network", () => {
  assert.equal(classifyError({ message: "request aborted" }), "network");
});

test("classifyError returns unknown for anything else", () => {
  assert.equal(classifyError({}), "unknown");
  assert.equal(classifyError(null), "unknown");
  assert.equal(classifyError("string"), "unknown");
});
