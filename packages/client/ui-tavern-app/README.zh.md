# `@deepseek-ai/dsh-client-ui-tavern-app`

[English](README.md) | 中文

Tavern 自有的浏览器应用根节点。它注册内置的 `root` 插槽，负责 Tavern 导航和 Journey 展示，并通过会话感知的子插槽渲染当前会话。Library 提供可见的 JSON 导入操作，用于添加 Character Card 和 World Book；导入成功后会立即出现在 Journey 设置中。Library 卡片也提供带明确确认的可访问删除操作；删除成功后会立即移除卡片，宿主拒绝删除时则保留资产，并在可操作的 alert 中显示原始原因。Tavern bundle 会禁用通用 AppFrame 与 conversation 根节点，因此归档当前 Journey 后会回到 Tavern library，不会暴露通用 composer。归档成功后根节点会显示状态提示；归档失败时会保留当前路由和 transcript 以便重试。归档 Library 中的非当前 Journey 不会影响正在打开的当前会话。

由于 Tavern profile 有意禁用通用 conversation UI，Journey 注册了自己的 Session Conversation 投影。已 accepted 的用户消息和最终 GM 消息都来自持久化的 session event window；最终失败的 turn 会作为 alert 保留，并提供将此前用户输入重新 queue 的重试操作。重试链仍在进行时隐藏中间失败；重试策略结束且没有 assistant message 时，最终失败会显示出来。

根节点拥有 `tavern.app` 双语字典，并将其注册到共享的 locale runtime。Settings 通过原生语言选择框使用同一个 runtime 偏好，因此中文或英文界面会立即更新；重新打开浏览器组合时也会恢复 Host 保存的语言偏好。

参见 [`docs/tavern-frontend-design.md`](../../../docs/tavern-frontend-design.md) 了解产品布局和生命周期决策。

## 模型体验

### Tavern 选择和 Journey 记录

#### 模型看到什么

Library 和 Settings 页面不会添加模型可见内容。开始 Journey 时，会在第一次请求前记录选中的 Character Card、World Book 和玩家身份；之后的记录输入通过现有 Session Runtime 发送。

#### Token 影响

资源检查不消耗模型 Token。选中的角色设定和 World Book 上下文会在 Journey Runtime 构造请求时占用提示词 Token。

#### KV Cache 影响

修改持久化选择会改变后续提示词前缀，可能改变 Provider Cache 的复用情况。

## 已知限制与后续工作

- **仅本次会话的偏好**——阅读模式开关只在当前浏览器会话中生效，不会持久化。
- **模型路由**——Settings 页面会显示当前默认路由，但在 Profile 暴露模型路由 Remote 前不会修改模型选择。
- **资源编辑**——此根组件可以导入 JSON Character Card 和 World Book；编辑已有源资源仍由 Host 能力负责。
- **响应式面板**——Journey 上下文抽屉面向单个 Session；多列比较和群聊仍待实现。
