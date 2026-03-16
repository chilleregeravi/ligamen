/**
 * graph.js — Entry point for AllClear service dependency graph UI.
 *
 * Orchestrates: project selection → data loading → force simulation → rendering.
 * All logic is in modules/ — this file is just the init flow.
 */

import { state } from "./modules/state.js";
import { render } from "./modules/renderer.js";
import { setupInteractions, setupControls } from "./modules/interactions.js";
import { hideDetailPanel } from "./modules/detail-panel.js";
import { showProjectPicker } from "./modules/project-picker.js";

async function init() {
  const canvas = document.getElementById("graph-canvas");
  const container = document.getElementById("canvas-container");

  function resize() {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    render();
  }
  window.addEventListener("resize", resize);
  resize();

  // Resolve project from URL or show picker
  const urlParams = new URLSearchParams(window.location.search);
  let project = urlParams.get("project");
  let hash = urlParams.get("hash");

  if (!project && !hash) {
    const picked = await showProjectPicker();
    if (!picked) return;

    if (picked.startsWith("__hash__")) {
      hash = picked.slice(8);
    } else {
      project = picked;
    }
  }

  if (project && !urlParams.get("project")) {
    const newUrl = new URL(window.location);
    newUrl.searchParams.set("project", project);
    window.history.replaceState({}, "", newUrl);
  }

  const projectParam = project
    ? `?project=${encodeURIComponent(project)}`
    : `?hash=${encodeURIComponent(hash)}`;

  // Load graph data
  let resp;
  try {
    resp = await fetch(`/graph${projectParam}`);
  } catch {
    document.getElementById("node-info").textContent = "Cannot reach server.";
    return;
  }

  if (!resp.ok) {
    document.getElementById("node-info").textContent =
      "No map data yet. Run /allclear:map first.";
    return;
  }

  const raw = await resp.json();

  // Map API response to UI shape
  const serviceNameToId = {};
  const mismatchSet = new Set(
    (raw.mismatches || []).map((m) => m.connection_id),
  );

  state.graphData.nodes = (raw.services || []).map((s) => {
    serviceNameToId[s.name] = s.id;
    return {
      id: s.id,
      name: s.name,
      language: s.language,
      type: s.type || "service",
      repo_name: s.repo_name,
    };
  });

  state.graphData.edges = (raw.connections || []).map((c) => ({
    id: c.id,
    source_service_id: c.source_service_id ?? serviceNameToId[c.source],
    target_service_id: c.target_service_id ?? serviceNameToId[c.target],
    protocol: c.protocol || "internal",
    method: c.method,
    path: c.path,
    source_file: c.source_file,
    target_file: c.target_file,
    mismatch: c.id ? mismatchSet.has(c.id) : false,
  }));

  state.graphData.mismatches = raw.mismatches || [];

  document.getElementById("node-info").textContent =
    `${state.graphData.nodes.length} services, ${state.graphData.edges.length} connections`;

  // Initialize positions
  state.graphData.nodes.forEach((n) => {
    state.positions[n.id] = {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
    };
  });

  // Start force simulation
  state.forceWorker = new Worker("./force-worker.js", { type: "module" });
  state.forceWorker.onmessage = ({ data }) => {
    if (data.type === "tick") {
      data.nodes.forEach(({ id, x, y }) => {
        state.positions[id] = { x, y };
      });
      render();
    }
  };
  state.forceWorker.postMessage({
    type: "init",
    nodes: state.graphData.nodes.map((n) => ({
      id: n.id,
      ...state.positions[n.id],
    })),
    links: state.graphData.edges.map((e) => ({
      source: e.source_service_id,
      target: e.target_service_id,
    })),
    width: canvas.width,
    height: canvas.height,
  });

  setupInteractions(canvas);
  setupControls();

  document.getElementById("detail-close").addEventListener("click", () => {
    hideDetailPanel();
    state.selectedNodeId = null;
    render();
  });
}

init().catch((err) => {
  document.getElementById("node-info").textContent = `Error: ${err.message}`;
  console.error(err);
});
