# Agent Dashboard

一个 Obsidian 插件，用于在一个自定义视图中统一呈现知识库活动、周期笔记、知识库巡检、TickTick 数据和项目追踪。

## 当前范围

插件当前已经提供：

- 自定义 dashboard 视图
- Ribbon 快捷入口
- `Open dashboard` 命令
- 设置面板，用于配置路径、TickTick/MCP、热力图尺寸和自定义动作

当前实际生效的界面，是一个顶部状态栏加五个主频道：

- `01 / 仓库`
- `02 / 日记`
- `03 / 巡检`
- `04 / TickTick`
- `05 / 项目`

## 各频道当前实际功能

- **仓库**：统计知识库分类数据，渲染迷你指标卡，并支持柱状图、日历图和热力图切换。
- **日记**：读取 `notebook-navigator` 的周期笔记规则；在可用时通过 `templater-obsidian` 创建笔记，并展示当前周期与去年同期预览。
- **巡检**：扫描收件箱积压、未入库日记、孤儿笔记、死链和空白笔记，同时提供可配置的 Claudian 动作按钮。
- **TickTick**：优先加载本地缓存，再通过 `mcp.json` 中定义的 HTTP MCP 端点同步任务、习惯、专注和项目数据。
- **项目**：读取 `Projects.base`，解析其中的过滤条件，并渲染项目表格，展示状态、创建时间和 topics。

## 重要说明

- 代码库中仍然保留了一些未挂载到当前界面的辅助渲染函数，所以不是所有现存函数都属于当前在线界面。
- 当前 `项目` 频道**不是** Kanban，看的是 `Base` 驱动的表格视图。
- TickTick 功能依赖可用的 MCP 配置；如果 MCP 不可用，界面会回退到占位数据。

## 安装指南

### 手动安装

1. 下载最新发布的 Release 资源文件 (`main.js`、`manifest.json`、`styles.css`)。
2. 将这些文件复制到你金库的插件目录中：`你的金库路径/.obsidian/plugins/agent-dashboard/`。
3. 重新加载 Obsidian，并在社区插件设置中启用 **Agent Dashboard**。

## 开发与编译

确保本地安装了 NodeJS >= v18。

1. 克隆本仓库。
2. 安装依赖：
   ```bash
   npm install
   ```
3. 启动开发 watch 监听服务：
   ```bash
   npm run dev
   ```
4. 运行生产环境编译打包：
   ```bash
   npm run build
   ```
5. 运行代码 Lint 静态检查：
   ```bash
   npm run lint
   ```
