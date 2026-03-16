/**
 * Detail panel — shows node info on click (services show calls, libraries show provides).
 */

import { state } from "./state.js";
import { getNodeType, getNodeColor } from "./utils.js";

export function showDetailPanel(node) {
  const panel = document.getElementById("detail-panel");
  const content = document.getElementById("detail-content");

  const outgoing = state.graphData.edges.filter(
    (e) => e.source_service_id === node.id,
  );
  const incoming = state.graphData.edges.filter(
    (e) => e.target_service_id === node.id,
  );

  const nameById = {};
  state.graphData.nodes.forEach((n) => (nameById[n.id] = n.name));

  const nodeType = getNodeType(node);
  const typeColor = getNodeColor(node);
  let html = `<h3>${node.name}</h3>`;

  html += `<div class="detail-section">
    <div class="detail-label">Type</div>
    <div class="detail-value" style="color:${typeColor}">${nodeType}</div>
  </div>`;

  html += `<div class="detail-section">
    <div class="detail-label">Language</div>
    <div class="detail-value">${node.language || "unknown"}</div>
  </div>`;

  if (node.repo_name) {
    html += `<div class="detail-section">
      <div class="detail-label">Repository</div>
      <div class="detail-value">${node.repo_name}</div>
    </div>`;
  }

  const isLib = nodeType === "library" || nodeType === "sdk";

  if (isLib) {
    html += renderLibraryConnections(outgoing, incoming, nameById);
  } else {
    html += renderServiceConnections(outgoing, incoming, nameById);
  }

  if (outgoing.length === 0 && incoming.length === 0) {
    html += `<div class="detail-section">
      <div class="detail-value" style="color: #718096">No connections</div>
    </div>`;
  }

  content.innerHTML = html;
  panel.style.display = "block";
}

function renderLibraryConnections(outgoing, incoming, nameById) {
  let html = "";

  if (outgoing.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Provides (${outgoing.length})</div>`;
    for (const e of outgoing) {
      const target = nameById[e.target_service_id] || "?";
      html += `<div class="connection-item">
        <div><span class="conn-method">${e.method || "fn"}</span> <span class="conn-path">${e.path || ""}</span></div>
        <div class="conn-direction">→ used by <span class="conn-target">${target}</span></div>
        ${e.source_file ? `<div class="conn-file">${e.source_file}</div>` : ""}
      </div>`;
    }
    html += `</div>`;
  }

  if (incoming.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Used by (${incoming.length} services)</div>`;
    const users = new Set();
    for (const e of incoming) {
      const source = nameById[e.source_service_id] || "?";
      if (!users.has(source)) {
        users.add(source);
        html += `<div class="connection-item">
          <div><span class="conn-target">${source}</span></div>
          ${e.source_file ? `<div class="conn-file">${e.source_file}</div>` : ""}
        </div>`;
      }
    }
    html += `</div>`;
  }

  return html;
}

function renderServiceConnections(outgoing, incoming, nameById) {
  let html = "";

  if (outgoing.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Calls (${outgoing.length})</div>`;
    for (const e of outgoing) {
      const target = nameById[e.target_service_id] || "?";
      const mismatchFlag = e.mismatch
        ? ' <span style="color:#fc8181;font-weight:bold" title="Endpoint not verified in target">✗</span>'
        : "";
      html += `<div class="connection-item" ${e.mismatch ? 'style="border-left:2px solid #fc8181"' : ""}>
        <div><span class="conn-method">${e.method || e.protocol}</span> <span class="conn-path">${e.path || ""}</span>${mismatchFlag}</div>
        <div class="conn-direction">→ <span class="conn-target">${target}</span></div>
        ${e.source_file ? `<div class="conn-file">${e.source_file}</div>` : ""}
        ${e.mismatch ? '<div class="conn-file" style="color:#fc8181">⚠ Endpoint handler not found in target</div>' : ""}
      </div>`;
    }
    html += `</div>`;
  }

  if (incoming.length > 0) {
    html += `<div class="detail-section">
      <div class="detail-label">Called by (${incoming.length})</div>`;
    for (const e of incoming) {
      const source = nameById[e.source_service_id] || "?";
      const mismatchFlag = e.mismatch
        ? ' <span style="color:#fc8181;font-weight:bold" title="Endpoint not verified">✗</span>'
        : "";
      html += `<div class="connection-item" ${e.mismatch ? 'style="border-left:2px solid #fc8181"' : ""}>
        <div><span class="conn-method">${e.method || e.protocol}</span> <span class="conn-path">${e.path || ""}</span>${mismatchFlag}</div>
        <div class="conn-direction">← <span class="conn-target">${source}</span></div>
        ${e.target_file ? `<div class="conn-file">${e.target_file}</div>` : ""}
        ${e.mismatch ? '<div class="conn-file" style="color:#fc8181">⚠ Endpoint handler not found in target</div>' : ""}
      </div>`;
    }
    html += `</div>`;
  }

  return html;
}

export function hideDetailPanel() {
  document.getElementById("detail-panel").style.display = "none";
}
