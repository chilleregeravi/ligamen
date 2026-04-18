/**
 * graph-states.js — Render loading / empty / error overlays over the graph canvas.
 *
 * Before this module, the UI silently showed "Loading..." in one corner and
 * produced no signal on failure. Now each terminal state renders a centered
 * card with an icon, message, and a context-appropriate CTA.
 *
 * The state machine lives in graph.js: idle → loading → ok | empty | error.
 * This module only renders; it does not own state.
 *
 * Template text is all plugin-controlled constants. The only string that
 * could come from the network (err.message) is written via .textContent to
 * keep XSS impossible regardless of what the worker returns.
 */

import { announce } from "./a11y.js";

const OVERLAY_ID = "graph-overlay";

function ensureOverlay() {
  let el = document.getElementById(OVERLAY_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = OVERLAY_ID;
  el.className = "graph-overlay";
  el.setAttribute("aria-live", "polite");
  const container = document.getElementById("canvas-container") || document.body;
  container.appendChild(el);
  return el;
}

function makeCard({ role, icon, iconClass, title, body, detail, ctaCmd, ctaLabel, retry }) {
  const card = document.createElement("div");
  card.className = "graph-overlay__card";
  if (role) card.setAttribute("role", role);

  if (icon !== undefined) {
    const iconEl = document.createElement("div");
    iconEl.className = `graph-overlay__icon${iconClass ? " " + iconClass : ""}`;
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;
    card.appendChild(iconEl);
  }
  if (title) {
    const h = document.createElement("h2");
    h.className = "graph-overlay__title";
    h.textContent = title;
    card.appendChild(h);
  }
  if (body) {
    const p = document.createElement("p");
    p.className = "graph-overlay__body";
    p.textContent = body;
    card.appendChild(p);
  }
  if (detail) {
    const code = document.createElement("code");
    code.className = "graph-overlay__detail";
    code.textContent = detail;
    card.appendChild(code);
  }
  if (ctaCmd) {
    const cta = document.createElement("code");
    cta.className = "graph-overlay__cta";
    cta.textContent = ctaCmd;
    if (ctaLabel) cta.title = ctaLabel;
    card.appendChild(cta);
  }
  if (retry) {
    const actions = document.createElement("div");
    actions.className = "graph-overlay__actions";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "graph-overlay__btn";
    btn.textContent = "Retry";
    btn.addEventListener("click", retry);
    actions.appendChild(btn);
    card.appendChild(actions);
  }
  return card;
}

export function hideOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (!el) return;
  el.hidden = true;
  el.replaceChildren();
}

/**
 * Classify an HTTP/network error so the UI can tell the user WHY it failed.
 *
 * @param {unknown} err
 * @returns {"network" | "not-found" | "auth" | "rate-limit" | "server" | "unknown"}
 */
export function classifyError(err) {
  if (err && typeof err === "object") {
    if ("status" in err) {
      const s = Number(err.status);
      if (s === 401 || s === 403) return "auth";
      if (s === 404) return "not-found";
      if (s === 429) return "rate-limit";
      if (s >= 500 && s < 600) return "server";
    }
    const name = typeof err.name === "string" ? err.name : "";
    const msg = typeof err.message === "string" ? err.message.toLowerCase() : "";
    if (name === "TypeError" && msg.includes("fetch")) return "network";
    if (msg.includes("networkerror") || msg.includes("failed to fetch")) return "network";
    if (msg.includes("aborted")) return "network";
  }
  return "unknown";
}

export function renderSkeleton() {
  const el = ensureOverlay();
  el.hidden = false;
  el.replaceChildren();
  const card = document.createElement("div");
  card.className = "graph-overlay__card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-label", "Loading graph");
  const skel = document.createElement("div");
  skel.className = "graph-overlay__skeleton";
  for (const mod of ["", "shimmer--wide", ""]) {
    const s = document.createElement("span");
    s.className = `shimmer shimmer--pill${mod ? " " + mod : ""}`;
    skel.appendChild(s);
  }
  card.appendChild(skel);
  const p = document.createElement("p");
  p.className = "graph-overlay__muted";
  p.textContent = "Fetching service graph…";
  card.appendChild(p);
  el.appendChild(card);
  announce("Loading service graph");
}

/**
 * @param {"no-project" | "no-scan-yet" | "filtered-out"} kind
 */
export function renderEmpty(kind) {
  const el = ensureOverlay();
  el.hidden = false;
  el.replaceChildren();
  const templates = {
    "no-project": {
      title: "No projects indexed yet",
      body: "Arcanon hasn't seen any scans on this machine. Run /arcanon:map in a repo to build your first service graph.",
      cta: "/arcanon:map",
    },
    "no-scan-yet": {
      title: "No scan data for this project",
      body: "The project exists but no findings were stored. Re-run /arcanon:map to populate the graph.",
      cta: "/arcanon:map full",
    },
    "filtered-out": {
      title: "No services match the current filters",
      body: "Loosen the protocol, layer, or boundary filters to see more nodes.",
      cta: null,
    },
  };
  const t = templates[kind] || templates["no-scan-yet"];
  el.appendChild(
    makeCard({
      icon: "∅",
      iconClass: "graph-overlay__icon--empty",
      title: t.title,
      body: t.body,
      ctaCmd: t.cta || undefined,
    }),
  );
  announce(t.title);
}

/**
 * @param {unknown} err
 * @param {() => void} retry
 */
export function renderError(err, retry) {
  const el = ensureOverlay();
  el.hidden = false;
  el.replaceChildren();
  const kind = classifyError(err);
  const title = {
    network:      "Can't reach the worker",
    "not-found":  "Project not found",
    auth:         "Authentication required",
    "rate-limit": "Rate-limited by the hub",
    server:       "Worker error",
    unknown:      "Something went wrong",
  }[kind];
  const body = {
    network:      "The Arcanon worker isn't responding. Is it running on port 37888?",
    "not-found":  "The project you asked for isn't indexed. Try picking another from the dropdown or run /arcanon:map.",
    auth:         "Your API key was rejected. Run /arcanon:login to update it.",
    "rate-limit": "Too many requests — the hub is asking us to wait a moment. Retry in a minute.",
    server:       "The worker returned a 5xx response. Check ~/.arcanon/logs/worker-*.log for details.",
    unknown:      "See the browser console or worker logs for details.",
  }[kind];

  const message =
    err && typeof err === "object" && "message" in err ? String(err.message) : "";

  el.appendChild(
    makeCard({
      role: "alert",
      icon: "!",
      iconClass: "graph-overlay__icon--error",
      title,
      body,
      detail: message || undefined,
      retry: typeof retry === "function" ? retry : undefined,
    }),
  );
  announce(`${title}. ${body}`, "assertive");
}
