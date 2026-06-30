* 这是一个 TypeScript 编写的 Obsidian community plugin 项目，不是 Obsidian Vault。
* 插件 ID 是 `vault-os`，显示名称是 `Vault OS`，版本是 `1.2.0`。
* 常用命令是 `npm install`、`npm run dev`、`npm run build`、`npm run lint`。
* Obsidian 插件目录中最终只需要 `main.js`、`manifest.json`、`styles.css`。
* 开发时优先使用 Obsidian 官方公开 API，不依赖未公开内部 API。
* 第一版实现保持最小、可测试、可迭代。
* 不要随意新增生产依赖。
* 涉及网络请求、遥测、云同步、删除文件、修改真实 Vault 之前必须先说明并等待确认。
* dashboard UI 相关任务优先参考 `frontend-design` skill。
* Obsidian API、生命周期、manifest、安全、无障碍、插件审核规则优先参考 `obsidian-plugin-skill` skill。
* 不要提交 API key、token、本地 Vault 路径或私人数据。
* 不要创建 Git remote，不要发布仓库，不要执行 `git commit`，除非我明确要求。
* 大范围修改前，先说明目标、涉及文件、最小实现方案。
* 修改代码后，运行 build；如有 lint，也运行 lint；最后总结修改内容和验证方式。
