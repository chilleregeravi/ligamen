/**
 * filter-panel.js — Wires all filter controls to state and render().
 *
 * Exports:
 *   setupFilterPanel()        — attaches event listeners to all filter controls
 *   populateFilterDropdowns() — reads state.graphData to fill boundary/language selects
 */

import { state } from "./state.js";
import { render } from "./renderer.js";

/**
 * Wire all filter controls in the collapsible #filter-panel.
 * Called from setupControls() in interactions.js after DOM is ready.
 */
export function setupFilterPanel() {
  // 1. Filters button toggle
  const filtersBtn = document.getElementById("filters-btn");
  const filterPanel = document.getElementById("filter-panel");
  filtersBtn.addEventListener("click", () => {
    state.filterPanelOpen = !state.filterPanelOpen;
    filterPanel.style.display = state.filterPanelOpen ? "flex" : "none";
    filtersBtn.classList.toggle("active", state.filterPanelOpen);
  });

  // 2. Protocol checkboxes (moved from setupControls in interactions.js)
  document.querySelectorAll("[data-protocol]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.activeProtocols.add(cb.dataset.protocol);
      else state.activeProtocols.delete(cb.dataset.protocol);
      render();
    });
  });

  // 3. Layer checkboxes
  document.querySelectorAll("[data-layer]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) state.activeLayers.add(cb.dataset.layer);
      else state.activeLayers.delete(cb.dataset.layer);
      render();
    });
  });

  // 4. Mismatches only
  document.getElementById("filter-mismatches-only").addEventListener("change", (e) => {
    state.mismatchesOnly = e.target.checked;
    render();
  });

  // 5. Hide isolated nodes
  document.getElementById("filter-hide-isolated").addEventListener("change", (e) => {
    state.hideIsolated = e.target.checked;
    render();
  });

  // 6. Boundary dropdown
  document.getElementById("filter-boundary").addEventListener("change", (e) => {
    state.boundaryFilter = e.target.value || null;
    render();
  });

  // 7. Language dropdown
  document.getElementById("filter-language").addEventListener("change", (e) => {
    state.languageFilter = e.target.value || null;
    render();
  });
}

/**
 * Populate the boundary and language <select> elements from live graph data.
 * Called after state.graphData.nodes is populated in loadProject().
 *
 * node.boundary is not present in the current data model — it will be added
 * when Phase 34 boundary data lands. The function handles the empty-list case
 * gracefully: selects stay as "All" only when no values are available.
 */
export function populateFilterDropdowns() {
  // Collect unique, non-empty language values from nodes
  const languages = [...new Set(
    state.graphData.nodes
      .map((n) => n.language)
      .filter(Boolean),
  )].sort();

  // Collect unique boundary values from nodes (node.boundary if present)
  const boundaries = [...new Set(
    state.graphData.nodes
      .map((n) => n.boundary)
      .filter(Boolean),
  )].sort();

  const langSelect = document.getElementById("filter-language");
  // Preserve current selection
  const prevLang = langSelect.value;
  langSelect.innerHTML = '<option value="">All</option>';
  languages.forEach((lang) => {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang;
    langSelect.appendChild(opt);
  });
  if (prevLang) langSelect.value = prevLang;

  const boundarySelect = document.getElementById("filter-boundary");
  const prevBoundary = boundarySelect.value;
  boundarySelect.innerHTML = '<option value="">All</option>';
  boundaries.forEach((b) => {
    const opt = document.createElement("option");
    opt.value = b;
    opt.textContent = b;
    boundarySelect.appendChild(opt);
  });
  if (prevBoundary) boundarySelect.value = prevBoundary;
}
