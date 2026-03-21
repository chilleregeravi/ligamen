import fs from "node:fs";
import path from "node:path";

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

/**
 * createLogger — returns a structured logger bound to a component tag.
 *
 * @param {object} opts
 * @param {string} opts.dataDir   - Base data directory (logs go to {dataDir}/logs/worker.log)
 * @param {number} [opts.port]    - Worker port; omitted from line when undefined or null
 * @param {string} [opts.logLevel="INFO"] - Minimum level to emit (DEBUG|INFO|WARN|ERROR)
 * @param {string} opts.component - Component tag included on every log line
 * @returns {{ log, info, warn, error, debug }}
 */
export function createLogger({ dataDir, port, logLevel = "INFO", component }) {
  function log(level, msg, extra = {}) {
    if (LEVELS[level] < LEVELS[logLevel]) return;

    const lineObj = {
      ts: new Date().toISOString(),
      level,
      msg,
      pid: process.pid,
    };

    if (port !== undefined && port !== null) {
      lineObj.port = port;
    }

    lineObj.component = component;

    // Merge any extra fields last so they don't override core fields accidentally
    Object.assign(lineObj, extra);

    const line = JSON.stringify(lineObj);
    fs.appendFileSync(path.join(dataDir, "logs", "worker.log"), line + "\n");
    process.stderr.write(line + "\n");
  }

  return {
    log,
    info(msg, extra = {}) {
      log("INFO", msg, extra);
    },
    warn(msg, extra = {}) {
      log("WARN", msg, extra);
    },
    error(msg, extra = {}) {
      log("ERROR", msg, extra);
    },
    debug(msg, extra = {}) {
      log("DEBUG", msg, extra);
    },
  };
}
