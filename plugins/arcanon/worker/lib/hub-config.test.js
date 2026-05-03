/**
 * worker/lib/hub-config.test.js — direct tests for the shared hub-config helper.
 *
 * Tests the precedence rules, boolean coercion, and the once-per-process
 * deprecation-warning contract directly against the shared module — independent
 * of its consumers (worker/cli/hub.js, worker/scan/manager.js).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  readHubAutoSync,
  _resetAutoUploadDeprecationWarnedForTests,
} from "./hub-config.js";

// Capture stderr writes during a test block. Restored by the caller.
function captureStderr() {
  const originalWrite = process.stderr.write.bind(process.stderr);
  const captured = [];
  process.stderr.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  return {
    captured,
    restore: () => {
      process.stderr.write = originalWrite;
    },
  };
}

// -----------------------------------------------------------------------------
// Precedence rules
// -----------------------------------------------------------------------------

test("readHubAutoSync: auto-sync=true returns true (no fallback)", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    assert.equal(readHubAutoSync({ "auto-sync": true }), true);
    assert.equal(
      capture.captured.filter((s) => s.includes("deprecated")).length,
      0,
      "no deprecation warning when new key is used",
    );
  } finally {
    capture.restore();
  }
});

test("readHubAutoSync: auto-sync=false returns false (no fallback)", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    assert.equal(readHubAutoSync({ "auto-sync": false }), false);
    assert.equal(
      capture.captured.filter((s) => s.includes("deprecated")).length,
      0,
    );
  } finally {
    capture.restore();
  }
});

test("readHubAutoSync: auto-sync wins over auto-upload regardless of value", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    assert.equal(
      readHubAutoSync({ "auto-sync": false, "auto-upload": true }),
      false,
      "explicit false on new key beats true on legacy key",
    );
    assert.equal(
      readHubAutoSync({ "auto-sync": true, "auto-upload": false }),
      true,
      "explicit true on new key beats false on legacy key",
    );
    assert.equal(
      capture.captured.filter((s) => s.includes("deprecated")).length,
      0,
      "no warnings — new key was defined in both cases",
    );
  } finally {
    capture.restore();
  }
});

test("readHubAutoSync: legacy auto-upload-only fires warning AND returns its value", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    assert.equal(readHubAutoSync({ "auto-upload": true }), true);
    const warnings = capture.captured.filter((s) =>
      s.includes("auto-upload"),
    );
    assert.equal(warnings.length, 1, "exactly one deprecation warning");
    assert.match(
      warnings[0],
      /deprecated/,
      "warning includes the word 'deprecated'",
    );
    assert.match(
      warnings[0],
      /auto-sync/,
      "warning names the new key (auto-sync)",
    );
    assert.match(
      warnings[0],
      /auto-upload/,
      "warning names the legacy key (auto-upload)",
    );
    assert.match(
      warnings[0],
      /v0\.2\.0/,
      "warning names the planned removal version",
    );
  } finally {
    capture.restore();
  }
});

test("readHubAutoSync: legacy auto-upload=false returns false (with warning)", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    assert.equal(readHubAutoSync({ "auto-upload": false }), false);
    assert.equal(
      capture.captured.filter((s) => s.includes("auto-upload")).length,
      1,
      "warning fires even when legacy key is false (key was defined → fallback path)",
    );
  } finally {
    capture.restore();
  }
});

// -----------------------------------------------------------------------------
// Empty / undefined input
// -----------------------------------------------------------------------------

test("readHubAutoSync: empty object returns false (default off)", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    assert.equal(readHubAutoSync({}), false);
    assert.equal(
      capture.captured.filter((s) => s.includes("deprecated")).length,
      0,
    );
  } finally {
    capture.restore();
  }
});

test("readHubAutoSync: undefined hub block returns false", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  assert.equal(readHubAutoSync(undefined), false);
});

test("readHubAutoSync: null hub block returns false", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  assert.equal(readHubAutoSync(null), false);
});

// -----------------------------------------------------------------------------
// Boolean coercion (per the Boolean(...) wrap in the implementation)
// -----------------------------------------------------------------------------

test("readHubAutoSync: truthy non-boolean (string 'yes') coerces to true", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    // Note: this is permissive; we don't reject malformed config, we coerce.
    assert.equal(readHubAutoSync({ "auto-sync": "yes" }), true);
    assert.equal(readHubAutoSync({ "auto-sync": 1 }), true);
  } finally {
    capture.restore();
  }
});

test("readHubAutoSync: explicit empty-string / 0 on new key returns false", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    // typeof !== "undefined" — these are defined values, not skipped to fallback.
    assert.equal(readHubAutoSync({ "auto-sync": "" }), false);
    assert.equal(readHubAutoSync({ "auto-sync": 0 }), false);
    assert.equal(
      capture.captured.filter((s) => s.includes("deprecated")).length,
      0,
      "no fallback to legacy key — new key was defined (just falsy)",
    );
  } finally {
    capture.restore();
  }
});

// -----------------------------------------------------------------------------
// Once-per-process deprecation-warning contract
// -----------------------------------------------------------------------------

test("readHubAutoSync: deprecation warning fires only once across many legacy reads", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    for (let i = 0; i < 10; i++) {
      readHubAutoSync({ "auto-upload": true });
    }
    const warnings = capture.captured.filter((s) =>
      s.includes("auto-upload"),
    );
    assert.equal(warnings.length, 1, "exactly one warning across 10 legacy reads");
  } finally {
    capture.restore();
  }
});

test("readHubAutoSync: _resetAutoUploadDeprecationWarnedForTests re-arms the warning", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    readHubAutoSync({ "auto-upload": true });
    assert.equal(
      capture.captured.filter((s) => s.includes("auto-upload")).length,
      1,
      "first read fires the warning",
    );
    readHubAutoSync({ "auto-upload": true });
    assert.equal(
      capture.captured.filter((s) => s.includes("auto-upload")).length,
      1,
      "second read does NOT fire the warning (flag latched)",
    );

    _resetAutoUploadDeprecationWarnedForTests();
    readHubAutoSync({ "auto-upload": true });
    assert.equal(
      capture.captured.filter((s) => s.includes("auto-upload")).length,
      2,
      "after reset, the next read fires the warning again",
    );
  } finally {
    capture.restore();
  }
});

test("readHubAutoSync: warning does NOT fire when only auto-sync is touched, even mixed with legacy", () => {
  _resetAutoUploadDeprecationWarnedForTests();
  const capture = captureStderr();
  try {
    readHubAutoSync({ "auto-sync": true });
    readHubAutoSync({ "auto-sync": false, "auto-upload": true });
    readHubAutoSync({ "auto-sync": true, "auto-upload": false });
    assert.equal(
      capture.captured.filter((s) => s.includes("deprecated")).length,
      0,
      "fallback path was never reached — no warnings",
    );
  } finally {
    capture.restore();
  }
});
