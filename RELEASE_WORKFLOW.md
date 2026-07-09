---
created: 2026-07-09
author: "[[Jarvis]]"
---

# Release Workflow

When the user mentions publishing, release, BRAT installation, or plugin distribution, execute this workflow by default.

Trigger examples:

- 发布
- release
- 重新 release
- 发一个版�?- BRAT 安装
- 别人怎么下载安装

This workflow has higher priority than ordinary `git push`. Ordinary sync commits and pushes code. Release publishing makes the plugin directly installable by Obsidian, BRAT, and manual installers.

## Project Paths

- Plugin directory: `D:\OneDrive\Sync\.obsidian\plugins\vault-os`
- Management directory: `D:\OneDrive\Sync\.obsidian\plugins\vault-os`
- GitHub repository: `https://github.com/lrb1019/vault-os`

## Release Goal

Every GitHub Release must provide both install paths:

- Standalone assets: `main.js`, `manifest.json`, `styles.css`
- Full package: `vault-os-vX.Y.Z.zip`

Do not upload only the zip. BRAT and the Obsidian plugin ecosystem more reliably recognize plugins when `manifest.json`, `main.js`, and `styles.css` are directly available from the Release.

## Preflight

Before publishing, verify:

- The repository root contains `manifest.json`.
- The Release version matches `manifest.json` `version`.
- `main.js`, `manifest.json`, and `styles.css` come from `D:\OneDrive\Sync\.obsidian\plugins\vault-os`.
- `main.js` passes `node --check main.js`.
- If code changed, run the project verification/build workflow, commit, tag, and push before creating or updating the Release.

## Zip Rule

The zip root must directly contain:

```text
main.js
manifest.json
styles.css
```

Runtime assets may live in subdirectories.

Never wrap the zip contents inside a top-level `Vault OS/` or `vault-os/` folder. BRAT will then fail to find `manifest.json` at the plugin root and may report that the package is not an Obsidian plugin.

## Expected Release Assets

For `vX.Y.Z`, assets should be:

```text
main.js
manifest.json
styles.css
vault-os-vX.Y.Z.zip
```

Download URL pattern:

```text
https://github.com/lrb1019/vault-os/releases/download/vX.Y.Z/main.js
https://github.com/lrb1019/vault-os/releases/download/vX.Y.Z/manifest.json
https://github.com/lrb1019/vault-os/releases/download/vX.Y.Z/styles.css
https://github.com/lrb1019/vault-os/releases/download/vX.Y.Z/vault-os-vX.Y.Z.zip
```

BRAT should use the repository URL:

```text
https://github.com/lrb1019/vault-os
```

Do not tell the user to use the SSH clone URL for BRAT. Do not make the zip URL the primary BRAT input.

## GitHub Release Steps (Standard Protocol)

To avoid BRAT caching errors and asset mismatch (which caused previous pull failures), **strictly follow this sequence**:

1. **Verify & Build**: Ensure `npm run build` succeeds locally.
2. **Version Bump**: Run `npm version patch` (or minor/major) in the plugin directory. This automatically updates `manifest.json` and `versions.json`, and creates the correct Git commit and tag synchronously.
3. **Push to Trigger Actions**: Run `git push origin main --tags`. The GitHub Action configured in the repository will automatically build and create a **Draft Release** with the standalone assets (`main.js`, `manifest.json`, `styles.css`).
4. **Local Zip**: Create a root-correct ZIP locally:
   `Compress-Archive -Path main.js, manifest.json, styles.css -DestinationPath vault-os-X.Y.Z.zip -Force`
5. **Publish**: The Release on GitHub must transition from **Draft** to **Published** before BRAT can see it. Wait for the GitHub Action to finish, then manually upload the local `vault-os-X.Y.Z.zip` to the Draft Release and click **Publish release**.

**Crucial Warning on BRAT failures:**
If you manually create a Release on GitHub without waiting for the assets, or if you ask BRAT to pull *while the Release is still a Draft*, BRAT will fail to find `main.js`/`manifest.json` and will **cache the failure**. To resolve this, you must go to BRAT settings, **Remove** the plugin entirely, and **Add** it again to force a clean fetch after the Release is officially published.

## Verification

After publishing, verify:

- Release assets include `main.js`, `manifest.json`, `styles.css`, and `vault-os-vX.Y.Z.zip`.
- The public zip root directly contains `manifest.json`, `main.js`, and `styles.css`.
- `manifest.json` is reachable from the Release download URL.
- BRAT installation uses `https://github.com/lrb1019/vault-os`.

If BRAT still says `manifest.json` is missing, diagnose GitHub Raw/API rate limiting or BRAT cache before changing code:

1. Open `https://raw.githubusercontent.com/lrb1019/vault-os/main/manifest.json`.
2. If it returns `429 Too Many Requests` or cannot be reached, this is GitHub access limiting, not plugin structure.
3. Ask the user to remove the plugin from BRAT and add it again.
4. If it still fails, use manual installation from the Release zip.

## Permissions And Safety

Release publishing is an external high-impact action. Wait for explicit user permission before creating or updating a Release.

If using a GitHub token:

- Never repeat the token in responses.
- Remind the user to revoke or rotate the token after publishing.
- Never write the token into the repository, docs, logs, or temp files.

## Final Response

After publishing, report only:

- Release URL.
- Uploaded asset list.
- BRAT repository URL.
- Verification result.
- Token revocation reminder if a token was used.
