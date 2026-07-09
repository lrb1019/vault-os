---
created: 2026-06-22
author: "[[Jarvis]]"
---

# Vault OS Codebook — 功能与实现细节记录

本文件作为 Vault OS 插件的代码库开发记录，便于后续查询、接续以及 AI Agent 读取上下文。

---

## 1. 插件基础配置与元数据
- **文件**：[manifest.json](file:///d:/OneDrive/Sync/.obsidian/plugins/Vault%20OS/manifest.json), [package.json](file:///d:/OneDrive/Sync/.obsidian/plugins/Vault%20OS/package.json)
- **实现细节**：
  - Plugin ID 统一设定为 `vault-os`，版本为 `1.2.0`。
  - 作者字段配置为 `Bylrb`，且通过 ESBuild 进行打包构建。

---

## 2. 插件入口与视图注册
- **文件**：[main.ts](file:///d:/OneDrive/Sync/.obsidian/plugins/Vault%20OS/src/main.ts)
- **实现方式**：
  - 清理了 Obsidian Sample Plugin 的全部冗余类（SampleModal、编辑器指令、click 监听）。
  - 定义 `AgentDashboardPlugin` 继承 `Plugin`。
  - 通过 `this.registerView()` 注册了类型为 `vault-os-view` 的 `AgentDashboardView`。
  - 绑定 Ribbon Icon（样式为 `layout-dashboard`）和全局 Command（`Open Dashboard`），二者均调用 `activateView()` 打开或聚焦已有的 Dashboard 工作区叶子节点（WorkspaceLeaf）。
  - 在卸载（`onunload()`）时，通过 `detachLeavesOfType()` 自动销毁对应视图。

---

## 3. 自定义设置页
- **文件**：[settings.ts](file:///d:/OneDrive/Sync/.obsidian/plugins/Vault%20OS/src/settings.ts)
- **实现方式**：
  - 定义了 `AgentDashboardSettings` 接口和默认值 `DEFAULT_SETTINGS`。
  - 新增设置项 `dashboardTitle`，当前默认值为 `"Vault OS"`。
  - 实现 `AgentDashboardSettingTab` 并在其 `display()` 方法中渲染输入框，值发生改变时同步写入本地并保存，同时自动触发已有 Dashboard 视图的重新渲染（刷新标题）。

---

## 4. 视图层与 DOM 渲染
- **文件**：[DashboardView.ts](file:///d:/OneDrive/Sync/.obsidian/plugins/Vault%20OS/src/DashboardView.ts)
- **实现方式**：
  - 继承自 Obsidian `ItemView`，绑定图标 `layout-dashboard`，视图文字为 `Vault OS`。
  - `onOpen()` 方法执行时渲染全部 DOM。通过划分子渲染函数维持代码可维护性：
    - `renderHeader()`: 渲染子标题、主标题（从插件 settings 获取）、LIVE 运行状态指示器以及一个绑定的 Refresh 刷新按钮（支持点击重新渲染视图）。
    - `renderActions()`: 渲染操作快捷键组，包含 `New Diary`、`Inbox Ingest`、`Vault Lint`、`Pull RSS Feeds`、`Weekly Report` 等五个按钮（包含 Hover 态与点击 Mock 反馈）。
    - `renderStatsCards()`: 渲染三张统计卡片：读书进度（当前书籍 + 百分比进度条 + 时间）、Inbox 积压数量（带阈值 Warning/Normal Badge）、今日任务流（基于 mock 计算 Done/Total 的百分比与 Overdue 计数）。
    - `renderHeatmap()`: 渲染 15 周的笔记创建热力图（GitHub Contribution style），各格子支持 Hover 显示当前日期创建篇数，支持点击触发 Notice 气泡通知。
    - `renderTodayDiary()`: 检查今日日记是否创建，如果已创建则展示日记路径及 Mock 摘要并提供“Open Diary Note”按钮。
    - `renderRecentReads()`: 渲染最近读书心得卡片列表，列出书名、进度、上次阅读时间及具体感慨。

---

## 5. 数据源 Mock
- **文件**：[mockData.ts](file:///d:/OneDrive/Sync/.obsidian/plugins/Vault%20OS/src/data/mockData.ts)
- **实现方式**：
  - 统一定义并导出了 Dashboard 界面所依赖的全部数据接口（`ReadingProgress`、`InboxBacklog`、`TaskOverview`、`DiaryStatus`、`HeatmapDay` 等）。
  - 编写了 `getMockHeatmapData()` 算法，基于固定日期（2026-06-22）向前推 105 天，模拟工作日活跃度高、周末活跃度低的卡片创建热力图格子的数据级别（Level 0 到 4）。

---

## 6. 视觉融入与自适应 CSS
- **文件**：[styles.css](file:///d:/OneDrive/Sync/.obsidian/plugins/Vault%20OS/styles.css)
- **实现方式**：
  - 核心设计思想是**去除科技风**，100% 融入用户当前的 Obsidian 主题。
  - 所有颜色和间距均通过 CSS 变量（CSS Custom Properties）取值：
    - 背景：`var(--background-secondary)` 作为卡片与主看板容器背景，`var(--background-primary)` 作为视图总背景与热力图空单元格底色。
    - 边框：`var(--border-color)` 与 `--border-width` 保持原生一致。
    - 字体：使用 `var(--font-interface)` 作正文，`var(--font-monospace)` 渲染统计数字及路径。
    - 主题色：热力图贡献格子的背景色，使用 `var(--interactive-accent)` 并结合 `opacity`（0.25 到 1.0）实现随 Obsidian 当前主题强调色自适应。
  - 引入 `@media (max-width: 768px)` 媒体查询。当插件处于侧边栏等窄窗口状态下，双列布局（Today's Diary + Recent Reads）会自动折叠为垂直单列，Header 控件会自动换行对齐，确保可用性。

---

## 7. 真实数据集成服务（Service Layer）
- **路径**：`src/services/`
- **实现方式**：
  - [ReadingService.ts](file:///d:/OneDrive/Sync/.obsidian/plugins/Agent%20Dashboard/src/services/ReadingService.ts): 负责从 `jarvis-reader` 的内存配置或 `.obsidian` 配置文件夹的 `data.json` 中，读取 Epub 阅读进度百分比、最后更新时间以及原子读书笔记内的想法评论。
  - [McpService.ts](file:///d:/OneDrive/Sync/.obsidian/plugins/Agent%20Dashboard/src/services/McpService.ts): MCP 客户端服务。实现基于 Server-Sent Events (SSE) 与 HTTP JSON-RPC 2.0 的 MCP 通信协议。读取 `.claude/mcp.json` 的服务器配置时，因 Obsidian 过滤点文件夹，采用底层的 `this.app.vault.adapter.read` 避开限制，并使用 `requestUrl` 规避浏览器 fetch 的跨域限制，与 HTTP MCP 服务（如 TickTick）进行直连。
  - [DiaryService.ts](file:///d:/OneDrive/Sync/.obsidian/plugins/Agent%20Dashboard/src/services/DiaryService.ts): 检测 `01 Daily/` 目录下本日日记是否创建。当已创建时解析出“今日重点”下的子项目作为摘要渲染；且绑定了“New Diary”按钮动作，支持自动在 `01 Daily` 中新建日记模板。
  - [TaskService.ts](file:///d:/OneDrive/Sync/.obsidian/plugins/Agent%20Dashboard/src/services/TaskService.ts): TickTick 任务数据服务。优先读取本地 MCP 服务更新的缓存文件 `07 Jarvis/ticktick-cache.json`；若配置了 MCP（即 `mcp.json` 中有 `ticktick` 服务），则调用 `McpService` 连接 MCP 自动获取工具列表，动态发现并调用获取任务的工具以统计今日、已完成、逾期状态。
  - [VaultService.ts](file:///d:/OneDrive/Sync/.obsidian/plugins/Agent%20Dashboard/src/services/VaultService.ts): 统计库内文件状态。包括扫描 `02 Inbox/` 待分类文件的计数与积压天数，以及遍历库内 markdown 文件修改时间生成 105 天滚动笔记热力图真实数据。
  - **动态结合**：`DashboardView.ts` 在 `onOpen` 以及刷新时通过上述服务异步拉取最新数据。当库内尚未产生真实文件或未配服务时，自动采用 `mockData.ts` 数据兜底展示，确保开发期间 UI 可正常渲染预览。
