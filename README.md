# Vault OS

Vault OS 是一个 Obsidian 个人心智工作首页。它把当天记录、周期复盘、思想脉络、个人智能指令与每日阅读回看集中到一个自定义视图中。

## 当前范围

当前一级入口为：

- **首页**：每日一句、今日日记、思想状态入口和每日阅读回看。
- **周期复盘**：日、周、月、季、年笔记的打开、创建和去年同期回望。
- **思想脉络**：分别展示正在形成的 Thinking、已形成理解与阶段性 Synthesis。
- **智能指令**：按用户自定义分类组织的 Skill 触发面板。

Vault OS 不复制任务管理器或项目管理器。时间管理和执行留在专用工具中；Vault OS 专注于知识沉淀、记录、复盘和维护。

## 安装

1. 下载 Release 中的 `main.js`、`manifest.json`、`styles.css`。
2. 放入 `你的仓库/.obsidian/plugins/vault-os/`。
3. 重新加载 Obsidian 后，在社区插件中启用 **Vault OS**。

## 初始设置

首次启用后，按自己的仓库情况选择：

1. 空白仓库可以直接使用首页和周期笔记入口；未配置的能力不会显示伪造数据。
2. 已有仓库可在 `仓库规则` 中扫描 Inbox 候选。候选只分析路径、标签和 frontmatter，必须由你确认后才保存。
3. 需要周期笔记模板时，配置 `Notebook Navigator` 与 `Templater`；未安装时 Vault OS 使用手动周期文件名回退规则。
4. 需要智能指令时，安装并启用 `realclaudian`，然后在设置页维护自己的动作。

## 目录与思想脉络设置

Vault OS 以目录角色识别当前仓库：Daily 服务记录与周期复盘，Inbox 是少量外部材料的临时入口，Thinking 保存个人思想，Synthesis 保存阶段综合，Archive 只作冷存储。

设置页只保留当前工作流真正需要的内容：

- **目录与周期**：配置 Daily、Inbox、Thinking、Synthesis 与 Archive；日、周、月、季、年文件模式和模板收在折叠区。
- **思想脉络**：应用 BYLRB README 推荐口径、查看 `stage` 识别规则，并维护永不读取的安全排除目录。
- **智能指令**：维护个人 Skill 分类、指令模板和可选输入框。

首次使用“思想脉络”时，应用 BYLRB 推荐口径。默认读取 `04 Thinking` 与 `05 Synthesis`，并在读取 frontmatter、正文和链接前执行全局路径排除。没有有效的文件夹排除规则时，思想脉络会安全停止。

旧 Atomics、Project、Question、Claim、Evidence、P0 与 Output 生命周期配置不再显示，也不参与思想脉络。历史保存值暂时保留，只用于兼容与必要时回滚。

## 周期复盘

周期页支持日、周、月、季、年五种周期：

- `Notebook Navigator` 可用时，读取其周期目录、命名规则和模板路径。
- 没有该插件时，手动模式生成不同的默认目标：`YYYY-MM-DD`、`YYYY-Www`、`YYYY-MM`、`YYYY-Qn`、`YYYY`。
- 创建前由用户显式点击；创建失败会显示原因。
- 页面提供当前周期和去年同期入口，但不会替你自动写复盘结论。

## 思想脉络

思想脉络与周期复盘职责分离：周期复盘以时间为主轴，回答“这段时间发生了什么”；思想脉络以 Thinking 为主轴，回答“我正在形成怎样的理解”。

- **正在形成**：`stage: developing` 以及尚未标注阶段的 Thinking；同时提示“尚未解决”章节是否仍有真实内容。
- **已形成理解**：`stage: settled` 的 Thinking。settled 只表示当前阶段愿意承担的判断，不代表永久正确。
- **阶段综合**：`05 Synthesis` 中的笔记，并显示它连接了多少条 Thinking。

页面只读取确认后的 Thinking 与 Synthesis 范围。每条卡片可以直接打开原笔记；没有内容时使用中性空状态，不会为了填满页面催促创建笔记。

传统维护被收进页面底部的折叠区域，只检查 Thinking 与 Synthesis 中的未解析链接和真正空白文件。它不计算健康分，不检查 Inbox 清零、待入库日记或孤儿笔记，也不自动修改任何内容。

旧 Question、Claim、Evidence、Output 与 P0 诊断代码仍作为高级兼容能力保留，但不再进入默认导航页面。

## 智能指令

智能指令完全由设置页定义，不内置固定 Skill 清单。它有独立一级入口，不与思想脉络混合。每条指令可配置名称、图标、提示词、是否需要输入、占位说明和所属分类；分类本身也可新增、编辑、删除。删除分类时，其中的指令会回到“未分类”，不会丢失。

模板变量：

- `{{input}}`
- `{{daily_path}}`
- `{{inbox_path}}`
- `{{atomics_path}}`
- `{{archive_path}}`
- `{{output_path}}`

Vault OS 只负责变量替换、Claudian 可用性检查和调用结果。依赖 Claudian 私有窗口与 DOM 的部分被隔离；插件不可用时会明确提示而不会丢失你的配置。

## 开发

需要 Node.js 18 或更高版本。

```text
npm install
npm run verify
```

`npm run verify` 依次运行：

1. Node 自动测试。
2. TypeScript 类型检查和生产构建。
3. ESLint。
4. 生成的 `main.js` 语法检查。

源码位于 `src/`，根目录 `main.js` 由构建生成，不应手工编辑。自动测试不能替代 Obsidian 隔离测试 Vault 的实机验收。

## 发布资源标准

每个正式 Release 必须同时提供四个独立附件：`main.js`、`manifest.json`、`styles.css` 与 `vault-os-v<version>.zip`。ZIP 的根目录只能包含前三项资源；缺少、为空或版本不一致时，`npm run package:release` 与标签 CI 必须失败，不能创建 Release。

## README 维护约定

修改用户使用方式、设置、依赖、数据范围或安全行为时，必须同步更新本文件和 `README_en.md`。文档以已验证的真实行为为准，不描述计划中或已撤销的功能。
