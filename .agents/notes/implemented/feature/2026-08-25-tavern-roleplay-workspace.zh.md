# Agent Note: Tavern 角色扮演工作台概览

Status: implemented

[English](2026-08-25-tavern-roleplay-workspace.md) | 中文

布局现在声明 root 级 `tavern` slot。Tavern 插件提供全屏入口导航和 Tavern 会话选择器；持久化 transcript 与 composer 仍由共享 `conversation` slot 渲染。

## 问题

Tavern 资源标签需要在不创建第二套会话存储和发送协议的前提下展示角色扮演上下文。只有资源面板时，当前角色的开场白和最近剧情状态会与即将接收用户回合的会话脱节。

## 决策

Tavern conversation view 在现有会话 composer 上方展示角色扮演工作台。工作台显示当前角色卡、开场白、单角色 direct 模式，以及从会话快照投影出的最近用户和角色文本。现有 conversation composer 仍是唯一发送入口，并继续负责输入准入、草稿持久化、流式输出、取消和 Session 传输。

conversation 插件通过 `conversationChatView` client service 暴露 Chat store、Host 操作和 ChatView 组件。Tavern 消费这个 service face，将共享的 value 实现保留在 `ui-conversation` 内，并满足 client bundle purity 约束。

Tavern 客户端挂载期间会在 document 上设置显式的 `dshSurface` 值；布局根据这个标记识别页面，而不是从 URL 推断。启动时优先选择已有的空 Tavern Session；没有时通过 Workspace service 创建，当前 Session 已有内容时保持不变。

未选择角色卡时，工作台显示明确的空状态，Tavern 角色扮演路径无法使用共享 composer。资源导入和 Session 选择继续通过现有 Host Remote 和追加式选择事件完成；空会话选择包含非空 `firstMessage` 的角色卡时还会写入一个持久化 `tavern/greeting` 事件。开场白会投影到共享 Chat 和 persona，但不会成为 `assistant/message`；浏览器包不拥有聊天记录或角色扮演状态。

Tavern Journey 的 Host 投影会以 `openingGreeting` 暴露持久化开场白，Journey client 在 transcript 节点之前渲染它。存在开场白时会隐藏空 transcript 提示，因此回放出的作者开场白不会被误判为没有内容。

同一个工作台还提供由 Host 负责的源 JSON 编辑和导出、按会话的 Memory upsert、规范的位置和时间 Story State 控件、持久化的 assistant Swipe 候选以及最近一次记录请求的 Prompt Inspector。这些控件都将领域事件追加到 Session 日志；工作台不维护并行的角色扮演数据库。

Journey client 通过一个右侧上下文抽屉提供角色扮演上下文，抽屉包含角色、世界和记忆三个标签页。角色条目使用投影后的角色字段并可逐项展开。世界视图只接受面向世界的投影字段，并过滤具有明显角色结构的世界书条目；导入资产时生成的 authored-asset 事实保留在角色或世界视图中，不进入记忆标签页。

World Info runtime compiler 使用所选资源中最小的 `scanDepth` 作为最近消息查询窗口，并使用最小的 `tokenBudget` 作为确定性的 first-fit 预算。中间概率使用由会话、来源和查询文本派生的稳定 roll；共享同一 group 的条目按确定性排序竞争。depth、sticky 和 cooldown 元数据会在 baseline 和激活 ledger 中保留来源跟踪；递归扫描和持久化 sticky/cooldown 计时器仍待实现。

## 考虑过的替代方案

**创建第二套 Tavern 输入机。** 这会重复草稿持久化、输入准入、取消和错误处理，并可能让消息通过与聊天记录不同的路径提交。

**在 Tavern 标签内渲染完整 ChatView。** 通用 conversation view 已经拥有聊天记录和 composer 布局，嵌套它会重复聊天流，并产生相互竞争的滚动区和输入区。

**将开场白追加为 `assistant/message`。** Session 校验要求 assistant 消息来自模型调用，伪造消息会违反事件到消息的约束。只记录日志的 `tavern/greeting` 事件让运行时和 Chat 从同一份作者文本重建开场白。

## 验证

- `packages/client/ui-tavern/tests/views.client.spec.tsx` 通过真实 slot 组合测试。
- Tavern client 包的类型检查和 bundle 构建通过。
- conversation client 包的类型检查和 bundle 构建通过。
- Tavern、greeting、ChatView 和 session skeleton 聚焦测试通过。
- Journey client 回归测试确认持久化角色卡开场白会渲染在会话消息之前。
- Host Swipe 投影以及客户端 Memory、Story State、Swipe 和 Prompt Inspector 控件的聚焦测试通过。
- 客户端上下文抽屉测试覆盖标签切换、键盘关闭、嵌入式世界书重复抑制、角色结构世界书条目过滤，以及记忆视图排除导入资产初始化事实。
- 加载生成的 client bundle 后，本地 Web 页面在 Tavern 工作台下方显示一个共享 composer。

## 结果

Tavern 标签是现有 Web conversation shell 内的角色扮演工作台，而不是第二套运行时。角色开场白和最近消息在资源选择处可见，完整聊天记录和发送行为仍由 `ui-conversation` 负责。持久化开场白只对空会话使用一次；会话已有内容后切换角色不会注入新角色卡的开场白。角色、世界和记忆上下文集中在一个可用键盘关闭的右侧抽屉中，记忆视图排除导入资产初始化事实，因此展示的是故事演化中的记忆条目。世界视图仍然是当前资产模型的投影，模型整理出的地理梗概属于独立能力。Memory、规范 Story State、持久化 Swipe 选择、源编辑和最近请求 Prompt Inspector 已可用；完整 fork/regenerate、备用开场白选择、按 observer 隔离的记忆检索、群聊、场景规划和 RAG 仍是独立能力。
