# Service Dependency Map

Ligamen scans your linked repositories with Claude agents to build an interactive service dependency graph. This is the core feature — it gives you a visual map of how your services connect, what they expose, and where changes might ripple.

## How It Works

1. Run `/ligamen:map` — Ligamen discovers your linked repos (from `ligamen.config.json` or by scanning sibling directories)
2. You confirm the repo list
3. Claude agents scan each repo — extracting services, endpoints, connections, and schemas
4. You review the findings — high-confidence results are shown as a batch for quick approval, while anything Ligamen is less sure about is shown individually for you to confirm or reject
5. Data is saved and the graph is ready
6. Open `http://localhost:37888` to explore

## What Gets Detected

**Services** — deployable units like HTTP servers, gRPC servers, event producers/consumers, daemons, workers, and serverless functions.

**Libraries/SDKs** — shared code imported by multiple services (shown in purple in the graph).

**Connections** — how services talk to each other, classified by type:

- `external` — network calls (REST, gRPC, events)
- `sdk` — shared library imports
- `internal` — within-service module calls

**Schemas** — request/response/event payload structures with field-level detail.

## Graph UI

Open with `/ligamen:map view` or navigate to `http://localhost:37888`.

**Node colors:**

- Blue — backend services
- Orange — frontend services
- Purple — libraries/SDKs

**Interactions:**

- Click a node — opens a detail panel with connections, methods, and files
- Shift+click — highlights the transitive blast radius (everything downstream)
- Drag on empty space — pan the viewport
- Mouse wheel — zoom in/out
- Protocol filters — toggle REST, gRPC, events, internal
- Search — filter by service name

**Keyboard shortcuts:**

- `F` — fit all nodes to screen
- `Esc` — deselect the current node and close the detail panel
- `/` — jump to the search input
- `I` — isolate selected node's immediate neighbors (press `2` or `3` to expand to 2-hop or 3-hop depth, `Esc` to exit)

**Exploring connections:**

When you click a node, the detail panel shows its connections as clickable links. Click a connected service name to jump to that node and open its detail panel, letting you traverse the graph without returning to the canvas.

**Edge bundling:**

When multiple connections exist between the same two services, they're bundled into a single thicker edge with a count badge. Click a bundled edge to see all individual connections with their protocol and endpoint details.

**What-changed overlay:**

After a re-scan, new or modified nodes get a glow ring and "NEW" badge, and new edges are highlighted — making recent changes visible at a glance.

**PNG export:**

Click the camera icon in the toolbar to download a screenshot of the current view.

**Mismatch indicators:**

- Red ✗ on edges where the endpoint handler wasn't found in the target service
- Red border in the detail panel for unverified connections

## Incremental Scanning

After the first full scan, `/ligamen:map` only re-scans repos with new commits since the last scan. Use `/ligamen:map full` to force a complete re-scan of everything.

## MCP Server

After building your first map, you can add the Ligamen MCP server so that all Claude agents (not just the session where you ran the scan) can check impact before making changes.

Add this to your Claude Code MCP settings (typically `~/.claude/settings.json` under `"mcpServers"`):

```json
{
  "mcpServers": {
    "ligamen-impact": {
      "type": "stdio",
      "command": "node",
      "args": ["<path-to-ligamen>/worker/mcp/server.js"]
    }
  }
}
```

This gives all Claude sessions access to these MCP tools: `impact_query`, `impact_changed`, `impact_graph`, `impact_search`, and `impact_scan`.
