# Vault OS

Vault OS is an Obsidian home surface for personal reflection. It brings daily capture, periodic review, a thinking map, personal AI actions, and daily reading reflection into one custom view.

## Current Scope

The primary navigation has four entries:

- **Home**: daily quote, today's journal, thinking status, and daily reading reflection.
- **Periodic Review**: open, create, and revisit daily, weekly, monthly, quarterly, and yearly notes.
- **Thinking Map**: developing Thinking notes, settled understanding, and stage-level Synthesis.
- **Smart Commands**: user-defined, category-based Skill launch panels.

Vault OS does not duplicate a task manager or project manager. Time-bound execution remains in dedicated tools; Vault OS focuses on knowledge capture, review, and maintenance.

## Install

1. Download `main.js`, `manifest.json`, and `styles.css` from a release.
2. Put them in `YourVault/.obsidian/plugins/vault-os/`.
3. Reload Obsidian and enable **Vault OS** under Community Plugins.

## Initial Setup

1. An empty vault can use Home and periodic-note entry points immediately. Unconfigured capabilities do not show fake data.
2. Configure the Daily, Inbox, Thinking, Synthesis, and Archive folder roles under **Paths & Periodic Notes**.
3. Configure `Notebook Navigator` and `Templater` if you want template-driven periodic notes. Without them, Vault OS falls back to manual periodic names.
4. Install `realclaudian` and define your own actions in Settings if you want AI actions.

## Paths and Thinking Map Settings

Vault OS uses folder roles: Daily supports capture and periodic review, Inbox is a temporary entry for selected external material, Thinking stores personal ideas, Synthesis stores stage-level understanding, and Archive remains cold storage.

The settings surface keeps only the active workflow:

- **Paths & Periodic Notes** configures Daily, Inbox, Thinking, Synthesis, and Archive. Detailed day, week, month, quarter, and year rules stay collapsed.
- **Thinking Map** applies the BYLRB README preset, explains the `stage` contract, and maintains folders that must never be read.
- **Smart Commands** manages personal Skill categories, prompt templates, and optional input dialogs.

The BYLRB preset reads `04 Thinking` and `05 Synthesis` by default and applies path exclusions before reading frontmatter, links, or note bodies. Without a valid folder exclusion, the Thinking Map fails closed.

Legacy Atomics, Project, Question, Claim, Evidence, P0, and Output lifecycle settings are no longer shown or used by the Thinking Map. Persisted values are retained only for compatibility and rollback.

## Periodic Review

The review page supports day, week, month, quarter, and year:

- When available, `Notebook Navigator` supplies its configured locations, patterns, and template paths.
- Without it, manual mode creates distinct targets: `YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`, `YYYY-Qn`, and `YYYY`.
- Creation is always initiated by an explicit user click, and failures are surfaced.
- The view provides current-period and previous-year entry points, but never writes your review conclusion automatically.

## Thinking Map

Periodic Review and Thinking Map have separate responsibilities. Periodic Review is time-based and asks what happened during a period. Thinking Map is idea-based and asks how personal understanding is developing.

- **Developing** shows `stage: developing` notes and notes without an explicit stage. It also detects meaningful content under the `尚未解决` heading.
- **Settled** shows `stage: settled` notes. Settled means a current position, not a permanent truth.
- **Synthesis** shows notes in the configured Synthesis scope and how many Thinking notes each one links to.

Each item opens its source note. Empty groups stay neutral and never pressure the user to create content. A collapsed maintenance section checks only unresolved links and truly empty files inside the configured Thinking and Synthesis scopes. It does not calculate a health score or treat Inbox size, un-ingested diaries, or orphan notes as failures.

Legacy Question, Claim, Evidence, Output, and P0 diagnostics remain available as advanced compatibility code, but no longer appear in the primary page.

## AI Actions

AI actions are entirely defined in Settings. Vault OS does not enforce a fixed Skill list. Each action can have a label, icon, prompt, optional input, and input placeholder.

Supported variables:

- `{{input}}`
- `{{daily_path}}`
- `{{inbox_path}}`
- `{{atomics_path}}`
- `{{archive_path}}`
- `{{output_path}}`

Vault OS handles template rendering, Claudian availability checks, and result feedback. The unstable Claudian plugin object and DOM hand-off are isolated; an unavailable plugin reports a clear message and does not discard your configuration.

## Development

Requires Node.js 18 or newer.

```text
npm install
npm run verify
```

`npm run verify` runs Node tests, TypeScript type checking and production build, ESLint, and a syntax check for generated `main.js`.

Source lives in `src/`. The root `main.js` is generated by the build and must not be edited manually. Automated tests do not replace real Obsidian validation in an isolated test vault.

## Release Asset Standard

Every release must ship four standalone assets: `main.js`, `manifest.json`, `styles.css`, and `vault-os-v<version>.zip`. The ZIP root may contain only the first three assets. Missing, empty, or version-inconsistent assets fail both `npm run package:release` and tag CI before a release can be created.

## README Maintenance

Update this file and `README.md` whenever user-facing behavior, settings, dependencies, data scope, or safety behavior changes. Documentation must describe verified behavior, not planned or removed features.
