# Vault OS

An Obsidian plugin that provides a unified dashboard for vault activity, periodic notes, vault health checks, TickTick data, and project tracking inside one custom view.

## Current Scope

The plugin currently exposes:

- a custom dashboard view
- a ribbon shortcut
- an `Open Vault OS` command
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
2. Copy the files into your vault directory: `YourVault/.obsidian/plugins/vault-os/`.
3. Reload Obsidian and enable **Vault OS** under Community Plugins.

## Usage Guide

### What To Configure First

After enabling the plugin, start with these four setup areas:

1. Fill in the `Paths` tab so diary, inbox, atomic notes, projects, archive, and output folders point to your real vault structure.
2. If you want automatic periodic diary creation, decide whether to pair the plugin with `notebook-navigator` and `templater-obsidian`.
3. If you want the custom buttons under the Lint tab, install and enable `realclaudian`.
4. If you want TickTick features, fill in the endpoint URL and headers under `TickTick connection`.

### What Each Settings Tab Controls

- `General`
  - Currently only keeps the dashboard title.
  - Low-frequency technical knobs were removed to keep the settings UI manageable.
- `Paths`
  - These are not cosmetic values. They define the plugin's data scope.
  - Everything inside the diary folder is treated as diary content.
  - The atomic notes folder defines the core scope for lint/orphan checks.
  - The projects folder and the Base file together define the Projects data source.
- `TickTick connection`
  - TickTick is now managed directly by this plugin instead of sharing another plugin's MCP config.
  - The effective fields are: enabled state, endpoint URL, headers, service identifier, and sync debounce.
- `Actions`
  - These are the custom Skill buttons shown at the bottom of the Lint page.
  - They do not execute local plugin logic by themselves. They send prompt templates to `realclaudian`.

### 01 / Vault

Purpose:

- Shows vault-wide Markdown counts, record days, average daily creation, folder-based distribution, and date-based charts.

What you need to do:

- Configure the `Diary / Inbox / Projects / Atomics / Output / Archive` folders first.
- Those paths directly affect category stats such as `Daily / Projects / Other`.

How the data is derived:

- Vault overview scans Markdown files across the entire vault.
- Record days are calculated from the earliest real file creation time in the vault.
- Chart dates prefer diary filename dates or frontmatter `created`, then fall back to file creation time.

### 02 / Diary

Purpose:

- Shows today's diary state, periodic note counts, creation entry points for day/week/month/quarter/year notes, and previous-period previews.

What you need to do:

- Set a `Diary folder path`.
- Any file inside that folder is treated as diary content for statistics.

Recommended integrations:

- `notebook-navigator`
  - If installed, the plugin reads the active profile's periodic note folder, naming rules, and template paths.
- `templater-obsidian`
  - If installed and paired with templates from `notebook-navigator`, periodic notes are created from those templates first.

Fallback behavior:

- Without those plugins, Vault OS creates Markdown files directly inside the configured diary folder.
- The fallback template writes:
  - `created: YYYY-MM-DD`
  - `author: "[[Jarvis]]"`
  - `ingested: false`

### 03 / Lint

Purpose:

- Uses one panel to inspect inbox backlog, un-ingested diaries, orphan notes, dead links, and empty notes, then summarizes them into a health score.

What you need to do:

- Configure `Inbox`, `Diary folder`, `Atomic notes folder`, and `Output folder`.
- Install and enable `realclaudian` if you want to use the custom action buttons at the bottom.

Current lint logic:

- `Inbox backlog`
  - Counts Markdown files inside the Inbox folder only.
- `Un-ingested diaries`
  - Counts Markdown files in the diary folder where frontmatter `ingested !== true`.
- `Orphan notes`
  - Checks only notes inside the atomic notes folder.
  - Link sources are resolved from atomic notes, output notes, and diaries.
  - `Index` files and health-check reports are excluded from orphan detection.
- `Dead links`
  - Counts unresolved links whose source files come from atomic notes, output, or Inbox.
- `Empty notes`
  - Scans the whole vault.
  - A note is treated as empty if nothing remains after removing frontmatter and heading-only lines.
  - That includes fully blank files, title-only files, and notes with metadata but no body.

#### How the Claudian Custom Buttons Work

These buttons are shown at the bottom of the Lint page.

- Buttons without an input field
  - Clicking sends the preset prompt directly to `realclaudian`.
- Buttons with an input field
  - If `Require input` is enabled, the button gets an input box on its left.
  - You can use `{{input}}` in the prompt template, and it will be replaced by the current input value.
- Path variables
  - Prompt templates support `{{daily_path}}`, `{{inbox_path}}`, `{{projects_path}}`, `{{archive_path}}`, `{{output_path}}`, and `{{atomics_path}}`.
  - These variables are automatically replaced with your configured folder paths.
- Icons
  - Icon names come from [Lucide Icons](https://lucide.dev/icons/).
  - Put the icon name into the settings field directly.

### 04 / TickTick

Purpose:

- Shows today's tasks, completion stats, habits, focus data, and connects them to TickTick through MCP.

What you need to do:

- Fill in these fields under `TickTick connection`:
  - enabled state
  - endpoint URL such as `https://mcp.ticktick.com`
  - headers such as `Authorization=Bearer ...`
- In most cases, keep the service identifier as the default `ticktick`.

How it runs:

- The view boots from a local cache first so the UI can render immediately.
- It then attempts a remote TickTick sync in the background.
- If the connection is unavailable, the UI falls back to placeholder guidance data.

### 05 / Projects

Purpose:

- Uses one Base file to define what counts as a project note, then aggregates matching notes into a stats panel and table.

Core mechanism:

- The Projects page does **not** simply show every note inside the projects folder.
- The real logic is:
  - read your configured `Projects.base`
  - evaluate its `filters`
  - scan vault Markdown files
  - include only files that match the filters

So you need both:

1. A project folder that stores project Markdown notes.
2. A `Projects.base` file that declares the matching rules.

Recommended project note template:

```md
---
status: active
topics:
  - "[[AI]]"
  - "[[Obsidian]]"
progress: 35
deadline: 2026-07-15
tags:
  - project
---

# Project title

> [!GOAL] Core goal
> Describe the project's central goal in one sentence.
```

Recommended field conventions:

- `status`
  - Recommended values: `pending`, `active`, `on hold`, `blocked`, `completed`, `cancelled`
  - Existing emoji-style states such as `🟢`, `🟡`, `🔴`, `🔵`, and `⚫` are also recognized
- `topics`
  - Supports string arrays
  - Supports wiki links like `[[Topic]]`, which render as clickable badges
- `progress`
  - Currently kept as metadata for future expansion
- `deadline`
  - Currently read from frontmatter, but not shown as a main table column

Recommended `Projects.base` filter example:

```yaml
filters:
  and:
    - file.path.contains("03 Projects/")
    - file.tags.contains("project")
```

What the current table displays:

- Name: file basename
- Status: frontmatter `status`
- Created time: real file creation time
- Topics: frontmatter `topics`

If you see mock example projects instead of your own data, it usually means:

- `Projects.base` did not match any files
- your project notes do not satisfy the configured filters
- you created a project folder, but did not pair it with a usable note structure and Base filter

## README Maintenance Rule

- Whenever the plugin gains a new usage flow, setting, dependency, or data rule, update the `Usage Guide` section in this README.
- If you maintain the Chinese version too, update `README.md` at the same time so the two documents do not drift again.

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
