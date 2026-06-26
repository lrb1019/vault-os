# Agent Dashboard

An Obsidian plugin that provides a unified dashboard for vault activity, periodic notes, vault health checks, TickTick data, and project tracking inside one custom view.

## Current Scope

The plugin currently exposes:

- a custom dashboard view
- a ribbon shortcut
- an `Open dashboard` command
- a settings tab for paths, MCP/TickTick integration, heatmap sizing, and custom actions

The live dashboard is organized into five main tabs:

- `01 / 仓库` (Vault)
- `02 / 日记` (Diary)
- `03 / 巡检` (Lint)
- `04 / TickTick`
- `05 / 项目` (Projects)

## What The Current Implementation Includes

- **Vault**: category statistics, mini metrics, and switchable bar/calendar/heatmap visualizations.
- **Diary**: periodic note resolution based on `notebook-navigator`, optional creation through `templater-obsidian`, and preview cards for current and previous periods.
- **Lint**: inbox backlog, un-ingested diary, orphan note, dead link, and empty note scanning, plus configurable Claudian actions.
- **TickTick**: local cache bootstrap and MCP-based sync for tasks, habits, focus sessions, and project lists.
- **Projects**: `Projects.base` filter parsing with a table-based project view.

## Important Notes

- Some helper renderers still exist in the codebase but are not mounted in the current UI.
- The current Projects tab is **not** a Kanban board. It is a Base-driven table.
- TickTick integration depends on a valid MCP configuration and reachable service.

## How to Install

### Manually

1. Download the latest release files (`main.js`, `manifest.json`, `styles.css`).
2. Copy the files into your vault directory: `YourVault/.obsidian/plugins/agent-dashboard/`.
3. Reload Obsidian and enable **Agent Dashboard** under Community Plugins.

## Development

Make sure you have NodeJS >= v18 installed.

1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run development watch server:
   ```bash
   npm run dev
   ```
4. Run production build:
   ```bash
   npm run build
   ```
5. Run linter:
   ```bash
   npm run lint
   ```
