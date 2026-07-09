---
created: 2026-06-22
author: "[[Jarvis]]"
---

# PROJECT_RULES

- 此项目为 Vault OS 插件项目，遵守 Obsidian 开发规范。
- 遵守 AGENTS.md 中的核心约束。
- **工作流 Skill 嵌入规范**：
  - 遇到前端布局、视觉设计或 UI 美化需求时，必须自动阅读并遵循 [frontend-design](file:///d:/OneDrive/Sync/03%20Projects/Agent%20Dashboard/skill/frontend-design/SKILL.md) 规范，确保界面自适应且层次清晰。
  - 遇到 Obsidian 插件生命周期、API 接口调用、内存管理或 TS 类型结构问题时，必须自动阅读并遵循 [obsidian-plugin-skill](file:///d:/OneDrive/Sync/03%20Projects/Agent%20Dashboard/skill/obsidian-plugin-skill/SKILL.md) 规范，严防内存泄露与多窗口兼容问题。
- **UI 与图标设计规范**：
  - 严禁在任何插件 UI 界面中使用彩色 Emoji 图标（如 `🤖`, `📥`, `🔍` 等）。
  - 所有图标必须统一使用符合 [Lucide Icons](https://lucide.dev/) 风格的单色线框图标（优先使用 Obsidian 原生 `setIcon(el, 'icon-id')` 接口挂载）。
  - 界面排版与视觉配色必须完全符合 Obsidian 原生生态，禁止硬编码非自适应的固定色彩，一律使用 Obsidian 系统提供的标准 CSS 变量（如 `--text-normal`, `--background-primary` 等）。
- **具体布局与样式规范**：
  - **下拉选择器**：所有的下拉选择菜单统一使用自定义的 `.ad-select` 样式，精细配置其在 Obsidian 中的边框、圆角与悬停效果，且必须重写 select/option 弹出列表的背景色，使其与金库的主题背景（如米黄/深灰底色）保持 100% 的色彩匹配。
  - **年度热力图**：仓库热力图、习惯打卡热力图与专注热力图必须渲染完整的 53 周 x 7 天网格。非活动、未打卡及未来日期必须统一使用低对比度的灰色小方块占位（`opacity: 0.3`），确保全站热力图视觉风格绝对一致。
  - **日期选择器**：高度固定为 `24px`，padding 为 `0 4px !important`，内部日期文本大小强制设为 `14px !important`，字重为 `500 !important`，以完全配平上方主菜单栏的字号大小。左右切换按钮采用 `20px` 宽高的无背景无边框微悬停圆角按钮，图标大小限制为 `14px`。
  - **无滚动条弹性高度**：严禁在卡片内写死图表或网格的固定高度（如 `140px` 等），应使用 `flex-grow: 1; min-height: 0;` 和 Flex/Grid 自动平铺延伸，避免产生垂直或水平滚动条。
- **README 维护规范**：
  - 插件仓库中的 `README.md` 必须长期保留“使用说明”板块，并以当前真实实现为准，不得按设想稿或过期方案书写。
  - 只要新增了新的使用方式、设置项、依赖关系、数据来源或判断口径，就必须同步更新 `README.md` 的“使用说明”。
  - `README_en.md` 必须与中文 README 同步维护，禁止中英文口径分叉。
