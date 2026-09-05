# `@deepseek-ai/dsh-client-ui-tavern`

Tavern profile 提供全屏 root 角色扮演界面；会话选择器使用共享 sessions 服务，资源和诊断工具位于次级入口。

[English](README.md) | 中文

旧版 Tavern conversation contribution 和面向数据的控件。当前 Tavern bundle 将 [`ui-tavern-app`](../ui-tavern-app/README.md) 作为唯一浏览器 root；本 package 暂时保留 Character Card greeting、message-edit 和兼容性测试，但应用 shell 正在迁移。本 package 不得拥有 root 可见性或导航状态。

完整聊天记录和请求（包括所有已记录的提示词头和工具 schema）仍然由现有 conversation 和 [`ui-trajectory`](../ui-trajectory/README.md) 页面提供。Tavern 标签不渲染第二套聊天记录或输入机；共享 conversation composer 仍是唯一发送路径。组合可选的模型选择插件后，Tavern 会把模型控件投影到“旅程设置”抽屉，并移除角色扮演 composer 中逐消息的模型入口。这个界面的资源库保持不可变：资源 JSON 编辑器只读，导出内容对应可复用的源资源。活动 Journey 可以编辑自己脱离的角色卡或世界书副本；这类编辑会追加 Journey 本地快照事件，不会修改资源库。选择和 reload 时，界面会请求 Host 根据 Journey baseline 准备已记录的动态栏目；世界书和世界人物详情展示这些 `label: value` 栏目，没有整理结果时回退到源文本行。自动 Journey 事实可以携带任意显示标签，同时保留自然语言正文，因此后续事实可以新增 `Secret` 或 `Player-specific` 等栏目；已有来源人物的最新 `Name` 事实会覆盖显示名，新人物则按 `person:<slug>` 进入人物列表；没有标签的事实归入 `Fact`。玩家可以编辑或撤销已有事实，但界面不提供手动创建事实的控件。Swipe 展示持久化的 assistant 候选、记录当前选择，并在子 Session 中启动重新生成。Prompt Inspector 展示最近一次记录的 system prompt、工具、assistant 正文、解析后的 GM `story` 和 `updates`、当前选择中的 World Info 条目，以及所选 baseline 的来源标识；剧情事实面板还会展示每一条已接受或已拒绝的事实事件、序号和拒绝原因。

Journey 布局和交互模型见 [Tavern 前端设计](../../../docs/tavern-frontend-design.md) 参考文档。

## 模型体验

无，因为 UI 不增加第二套消息或 composer 路径。Host runtime 会把资源选择、已接受的自动事实、旧版 Memory 条目和位置/时间 Story State 投影到后续模型请求；事实来源会保留 Session 事件序号，供 Prompt Inspector 和审计视图追溯。

#### KV Cache 影响

用户保存资源选择、编辑或撤销 Journey 事实，或使用旧版 Memory、Story State 控件时，插件会改变后续提示词内容；新导入的源资源只会为未来 Journey 选择改变 cache key。

## 已知限制与后续工作

- **PNG 导入有限制**：只读取角色卡 PNG 中未压缩的 `chara` 元数据，不保存图片字节；不处理可执行的 SillyTavern 扩展。
- **提示词详情范围**：Prompt Inspector 展示最近一次已记录的请求、assistant 正文、解析后的 GM envelope 和所选资源 baseline；剧情事实面板展示完整事实事件审查；完整请求历史和提示词变更时间线请使用 Trajectory。
- **事实整理**：有可用模型路由时使用所选模型整理动态栏目，否则使用确定性的源文本行。事实标签是可选的显示元数据；事实压缩和更丰富的多条目整理仍待实现。
- **后续 Tavern 层**：群聊、场景编排、备用开场白选择、按 observer 隔离的记忆检索和 RAG 仍属于独立能力。角色扮演界面支持候选 Swipe 选择和在子 Session 中重新生成，但不提供通用 fork 命令。
