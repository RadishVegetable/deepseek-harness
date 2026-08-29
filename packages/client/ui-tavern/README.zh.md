# `@deepseek-ai/dsh-client-ui-tavern`

Tavern profile 提供全屏 root 工作区，包含角色扮演、资源库和提示词上下文导航；会话选择器使用共享 sessions 服务。

[English](README.md) | 中文

可选的 Tavern 工作台。它注册一个 `conversation.view` 标签页，读取现有会话快照和 Trajectory target，展示当前角色卡和开场白，投影最近的持久化角色扮演消息，列出、导入、编辑和导出角色卡/World Info 资源，把当前选择记录到 Session 日志，并提供按会话的 Memory、位置/时间 Story State 和 Prompt Inspector 控件。它不拥有会话状态；资源存储和会话选择由 Host Remote 负责。

完整聊天记录和请求（包括所有已记录的提示词头和工具 schema）仍然由现有 conversation 和 [`ui-trajectory`](../ui-trajectory/README.md) 页面提供。Tavern 标签不渲染第二套聊天记录或输入机；共享 conversation composer 仍是唯一发送路径。资源编辑器会在原资源 ID 下更新保留的源 JSON，并下载由 Host 序列化的 JSON。Memory 编辑通过会话 Remote 保存；Story State 编辑仅支持规范的位置和时间变更；Swipe 展示持久化的 assistant 候选、记录当前选择，并在子 Session 中启动重新生成。Prompt Inspector 展示最近一次记录的 system prompt 和工具、当前选择中的 World Info 条目，以及所选 baseline 的来源标识。

工作台布局和交互模型见 [Tavern 前端设计](../../../docs/tavern-frontend-design.md) 参考文档。

## 模型体验

无，因为 UI 不增加第二套消息或 composer 路径；通过 UI 保存的资源选择、Memory 条目和位置/时间 Story State 会由 Host runtime 投影到后续模型请求。

#### KV Cache 影响

只有在用户保存资源选择、Memory 条目或 Story State 值时，本插件才会改变后续提示词内容；这些变化可能影响后续请求的提示词前缀复用。

## 已知限制与后续工作

- **PNG 导入有限制**：只读取角色卡 PNG 中未压缩的 `chara` 元数据，不保存图片字节；不处理可执行的 SillyTavern 扩展。
- **提示词详情范围**：Prompt Inspector 展示最近一次已记录的请求和所选资源 baseline；完整请求历史和提示词变更时间线请使用 Trajectory。
- **后续 Tavern 层**：群聊、场景编排、备用开场白选择、按 observer 隔离的记忆检索和 RAG 仍属于独立能力。工作台支持候选 Swipe 选择和在子 Session 中重新生成，但不提供通用 fork 命令。
