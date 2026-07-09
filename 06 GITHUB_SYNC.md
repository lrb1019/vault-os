---
created: 2026-06-25
author: "[[Jarvis]]"
---

# GitHub 同步指南

当用户说“同步到 GitHub”、“推送”或“GitHub 同步”时，智能体将遵循此流程进行自动同步。

## 统一同步要求

- **项目与代码目录**：`D:\OneDrive\Sync\.obsidian\plugins\vault-os`
- **所有改动合并**：项目的所有文档（例如 `00 项目总览.md`、`06 GITHUB_SYNC.md`、`RELEASE_WORKFLOW.md` 等）与插件源代码已经合并于同一目录中。
- **自动提交**：执行 GitHub 同步时，会将代码的修改与文档的更新一并提交，确保云端与本地状态完全同步。

## 仓库信息

- **本地目录**：`D:\OneDrive\Sync\.obsidian\plugins\vault-os`
- **远程仓库**：`https://github.com/lrb1019/vault-os.git`
- **主分支**：`main`
- **核心文件**：`main.js`、`styles.css`、`manifest.json`、`README.md`、`README_en.md` 等。

## 同步自动执行清单

1. 确认本次修改范围。
2. 确认版本号是否需要升级。
3. 更新 `03 改动日志.md` 记录改动。
4. 运行 `npm run build` 确保最新的代码成功编译。
5. 运行 `git add .`、`git commit -m "commit message"` 进行本地提交。
6. 运行 `git push origin main` 将改动推送到 GitHub 远程仓库。

## 提交规范

推荐提交信息格式：
- `feat: ...` (新增功能)
- `fix: ...` (修复问题)
- `docs: ...` (更新文档)
- `refactor: ...` (重构代码)
