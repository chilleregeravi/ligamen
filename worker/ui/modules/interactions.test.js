/**
 * Verification tests for interactions.js wheel handler.
 * Tests that the handler uses the smooth continuous delta formula
 * and correctly splits pan vs zoom based on ctrlKey.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "interactions.js"), "utf8");

let passed = 0;
let failed = 0;

function check(condition, description, pattern) {
  if (condition) {
    console.log(`OK: ${description}`);
    passed++;
  } else {
    console.error(`FAIL: ${description}${pattern ? ` (missing: ${pattern})` : ""}`);
    failed++;
  }
}

// ctrlKey branch must be present (split zoom vs pan)
check(src.includes("e.ctrlKey"), "ctrlKey branch present", "e.ctrlKey");

// Exponential zoom delta — Math.pow(2, ...) formula
check(src.includes("Math.pow(2,"), "exponential zoom delta formula", "Math.pow(2,");

// Sensitivity constant must be defined
check(src.includes("SENSITIVITY"), "SENSITIVITY constant defined", "SENSITIVITY");

// Pan path: x axis
check(src.includes("state.transform.x -= e.deltaX"), "pan on X axis", "state.transform.x -= e.deltaX");

// Pan path: y axis
check(src.includes("state.transform.y -= e.deltaY"), "pan on Y axis", "state.transform.y -= e.deltaY");

// Passive flag preserved
check(src.includes("passive: false"), "passive flag preserved", "passive: false");

// Lower zoom bound changed from 0.2 to 0.15
check(src.includes("Math.max(0.15,"), "lower zoom bound is 0.15", "Math.max(0.15,");

// Upper zoom bound stays at 5
check(src.includes("Math.min(5,"), "upper zoom bound is 5", "Math.min(5,");

// Old coarse fixed-step delta MUST be gone
check(
  !src.includes("e.deltaY < 0 ? 1.1 : 0.9"),
  "old coarse delta (1.1/0.9) removed",
  null
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
