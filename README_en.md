# Vault OS

Vault OS is an Obsidian home surface for personal knowledge work. It brings daily capture, periodic review, vault health checks, personal AI actions, and daily reading reflection into one custom view.

## Current Scope

The primary navigation has four entries:

- **Home**: daily quote, today's journal, review and health entry points, and daily reading reflection.
- **Periodic Review**: open, create, and revisit daily, weekly, monthly, quarterly, and yearly notes.
- **Vault Health**: workflow diagnostics, inbox backlog, un-ingested diaries, orphan candidates, dead links, and empty notes.
- **Smart Commands**: user-defined, category-based Skill launch panels.

Vault OS does not duplicate a task manager or project manager. Time-bound execution remains in dedicated tools; Vault OS focuses on knowledge capture, review, and maintenance.

## Install

1. Download `main.js`, `manifest.json`, and `styles.css` from a release.
2. Put them in `YourVault/.obsidian/plugins/vault-os/`.
3. Reload Obsidian and enable **Vault OS** under Community Plugins.

## Initial Setup

1. An empty vault can use Home, empty-note scanning, and periodic-note entry points immediately. Unconfigured capabilities do not show fake data.
2. An existing vault can scan Inbox candidates in `Vault Rules`. Candidate detection reads paths, tags, and frontmatter only; it is saved only after your confirmation.
3. Configure `Notebook Navigator` and `Templater` if you want template-driven periodic notes. Without them, Vault OS falls back to manual periodic names.
4. Install `realclaudian` and define your own actions in Settings if you want AI actions.

## Vault Rules

Vault OS does not require folders named `01 Daily` or `02 Inbox`. Its core model uses semantic roles such as journal source, inbox source, knowledge scope, and output scope.

Inbox currently supports:

- one folder, optionally recursive;
- one or more tags;
- a frontmatter property and values;
- the full Markdown vault.

Legacy path settings still produce a compatibility rule at runtime, so an existing vault keeps its previous direct-child Inbox scan until you explicitly choose a new rule.

For a first setup, use the **Quick start** section to confirm a global safety exclusion and, when applicable, apply the current-vault recommended mapping. It enables the existing Project, Question, Claim, Evidence, and Output recognition without defining P0 priority or Output lifecycle states. The remaining rules stay collapsed under **Advanced rules** until the workflow needs them.

Workflow diagnostics also use an explicit knowledge-entity contract. It separately identifies Question, Claim, and Evidence entities. Its relationship semantics are deliberately fixed: Question/Claim wiki-link association, Output outbound links to Claims, and Evidence `supports` links to Claims. Without a complete contract, knowledge-graph checks remain unconfigured rather than inferring entities from ordinary Markdown.

## Periodic Review

The review page supports day, week, month, quarter, and year:

- When available, `Notebook Navigator` supplies its configured locations, patterns, and template paths.
- Without it, manual mode creates distinct targets: `YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`, `YYYY-Qn`, and `YYYY`.
- Creation is always initiated by an explicit user click, and failures are surfaced.
- The view provides current-period and previous-year entry points, but never writes your review conclusion automatically.

## Vault Health

Workflow diagnostics are read-only. They show a knowledge-flow view: completed Project entities still in the Projects scope; active Claims used by a Project or Output without structured `Evidence.supports`; Evidence with no `supports`, malformed `supports`, or unresolved `supports` targets; and Question or Output link-gap candidates. Each result exposes its deterministic trigger evidence before opening the underlying note. Ordinary links only establish association, never an asserted answer or completed lifecycle. P0 Claim evidence debt remains unconfigured until the user defines an explicit P0 Claim rule.

The smallest knowledge chain is: a `Question` wiki-links with a `Claim`; an `Evidence` declares `supports: "[[Claim]]"` (or a string array); and an `Output` links to the Claim it uses. Existing notes do not need migration: adopt this structure gradually for new research, projects, and outputs.

Configure at least one global folder exclusion before semantic inspection. Without it, inspection fails closed before frontmatter, links, or note bodies are read. Excluded paths are also omitted from snapshots, reports, and issue lists. A snapshot is written only when you explicitly save a baseline; it contains issue identifiers, titles, and a timestamp, never note bodies. Changes to diagnostic rules invalidate comparisons with prior baselines.

Universal checks:

- unresolved links;
- empty Markdown files.

Checks that require a configured scope:

- inbox backlog;
- un-ingested diaries;
- orphan-note candidates.

Empty-note cleanup follows a fixed flow: scan candidates, select files, acknowledge the action, move selected files to the Obsidian trash, and show per-file results. Archiving similarly previews source and target and refuses to overwrite an existing file.

Monthly health reports are created in the configured output folder and never overwrite an existing report with the same name.

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
