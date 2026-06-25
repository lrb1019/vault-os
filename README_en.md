# Agent Dashboard

An Obsidian plugin that acts as a Systematic Precision Console for tracking AI agent workflows, notes telemetry, system health, TickTick tasks, and projects in a unified, three-column control center.

## Key Features

- **Telemetry Header**: Monospace telemetry summary showing the dashboard title (customizable via settings) and live system uptime.
- **Control Bus (Left Sidebar)**: Direct access to core documentation status, active plugins autodetect, and recent files feed (automatically collapses on screens < 900px).
- **Multi-channel Viewport (Right Sidebar)**:
  - **`01 / 仓库` (Vault)**: Color-coded vault capacity segment bar, weekly stats chart, monthly calendar, and teal-themed annual contribution heatmaps.
  - **`02 / 日记` (Diary)**: Check-in board linked to daily notes, today's note quick creation/preview, and live summaries for monthly, quarterly, and yearly review files.
  - **`03 / 巡检` (Lint)**: Interactive circular health gauge, orphanage notes scanner, dead link resolver, and file ingest controller modal.
  - **`04 / TickTick`**: Integrates with TickTick for habit tracking (dynamic weekly check-in grids and 53-week heatmaps), custom lists task manager (with project selector filter), and focus/pomodoro stats.
  - **`05 / 项目` (Projects)**: Active project kanban automatically parsed from frontmatter inside the `03 Projects` directory, showing progress and last modified dates.

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
