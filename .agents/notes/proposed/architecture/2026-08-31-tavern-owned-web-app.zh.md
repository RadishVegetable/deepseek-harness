# Agent Note: Tavern 自主拥有的 Web 应用

Status: proposed

[English](2026-08-31-tavern-owned-web-app.md) | 中文

## 问题

当前 Tavern profile 将 Tavern 内容挂载到通用的 DeepSeek Harness Web 应用中。`AppFrame` 拥有浏览器根节点，通用对话视图拥有 composer；而 Tavern 提供一个根侧界面和一个 Session 作用域的对话视图。这三个所有者不共享同一份导航状态。

归档当前 Journey 会清除当前 Session。这会正确移除 Session 作用域的 Tavern 视图，但也会移除原先隐藏通用 composer 的 CSS 标记。此时通用 Harness 视图重新可见，尽管 Tavern 已经选择了资料库页面。结果看起来像跳转到了 DeepSeek Harness，实际上是同一棵根树中未受控制的回退。

Tavern 产品不能依赖通用编程 agent 外壳、侧边栏、composer 或 DOM 范围的 CSS 标记来完成普通产品导航。它需要一个由 Tavern 拥有页面和 Session 生命周期的 Web 应用，同时保留 dsh 的 Web 传输、Session 持久化、模型执行和 Tavern 宿主能力。

本决策替代[带来源上下文的 Tavern 角色扮演界面提案](../feature/2026-08-24-tavern-roleplay-surface.md)中“将 Tavern 页面加入现有 Web GUI”的客户端组合描述。它不重新定义 [Tavern 前端设计](../../../../docs/tavern-frontend-design.md)中的产品流程、GM 剧情循环或持久化 Journey 数据。

## 提案

Tavern profile 组合一个由 Tavern 自主拥有的浏览器根应用 `ui-tavern-app`。它是该 profile 中唯一注册渲染根节点的插件。该应用使用常规 dsh 客户端运行时服务和 Remote API，但不挂载 `ui-layout`、`ui-sidebar`、`ui-conversation` 或其他通用 Harness 页面作为视觉回退。

`ui-tavern-app` 拥有产品导航、活动页面加载、响应式布局、通知，以及资料库和 Journey 页面之间的全部转换。既有 Tavern 卡片、编辑器、故事呈现和控件会成为这个根应用之下的 Tavern 组件。非视觉客户端模块仍可暴露共享的 Session 或消息行为，但没有通用 React 根节点可以拥有 Tavern 路由选择或 composer。

### 产品所有权

根应用拥有下列产品路由：

- `library` 显示角色、Journey 以及首次使用状态。
- `journey` 显示一个已标识 Journey、它的故事 transcript、composer 和 Journey 作用域控件。
- `history` 显示已归档 Journey，并允许明确的恢复或打开操作。
- `settings` 包含不属于故事轮次的产品级生成、外观和诊断控件。

路由状态和当前 Session 状态彼此独立。路由选择一个不透明的 Journey id；Session 服务提供该路由所需的持久化记录和执行句柄。缺失、已归档或不可用的 id 会带 Tavern 通知解析到 `library`，绝不能导致通用对话视图渲染。

源资产删除是独立的、需要确认的 Library 操作。根应用调用宿主的持久化删除 Remote，成功后立即从可见列表移除；宿主拒绝时则保留资产和对话框。拒绝消息会保留在 alert 中，不会丢失“资产正在使用”等说明；删除资产不会删除 Journey transcript。

删除转换是一个由根应用拥有的操作：

```text
archive active Journey succeeds
  -> clear the app's active Journey reference
  -> navigate to library
  -> refresh the Journey and history projections
```

如果归档失败，路由和 transcript 保持原状，应用展示错误。归档非活动 Journey 时只刷新资料库，不改变当前路由。浏览器重载会在可能时恢复有效 Journey 路由；否则打开资料库。根应用在这些转换中始终保持挂载。

### 客户端组合

Tavern bundle 选择产品组合，而不是隐藏通用组合的一部分：

- `ui-tavern-app` 注册唯一根节点，并拥有所有 Tavern 页面布局。
- Tavern 资源、Journey、叙事和设置客户端向该根节点暴露类型化数据和命令。
- 可继续使用 dsh 的浏览器启动、连接恢复、本地化、主题 token、Remote 调用、Session 日志、流式执行和审批等基础能力。
- 通用 Harness 布局、通用侧边栏、通用对话渲染器、通用 composer、工作区导航及其 CSS 不在 Tavern profile 中。

Tavern 文案归属于 `tavern.app` locale namespace。根应用向共享 locale runtime 注册完整的中英文词典，自有 Settings 页面通过 runtime 的标准服务写入 Host 的语言偏好。所有渲染产品文案的 Tavern slot 都接收标准 locale seat，因此切换语言会同步更新根应用和 Journey 页面，不需要本地存储镜像或第二套 locale context。

只有当一个通用展示组件接收明确的 Tavern props，且不能选择 Session、挂载根节点、改变导航或添加全局 CSS 时，应用才可以复用它。产品专属的消息渲染和 composer 行为属于 Tavern 组件。`document.documentElement.dataset` 以及协调不同视觉所有者的选择器不是导航机制，必须从 Tavern 路径中移除。

### Remote API 和数据流

宿主仍然是角色资源、Journey 创建、Session 归档与恢复、transcript 投影、模型执行和持久化状态的权威来源。浏览器不复制这些存储，也不从 DOM 推断它们的状态。

`ui-tavern-app` 读取资料库、单个 Journey 和历史记录的类型化投影，再调用类型化命令来创建、打开、归档、恢复、提交、重新生成或更新产品设置。如果现有 dsh Session API 没有某个路由所需的产品级语义，Tavern 应定义带有该语义的显式 Remote 方法，而不是访问通用 UI store。结果携带权威的不透明 id 和足够的状态，让根应用选择下一条路由。

流属于活动的 `journey` 路由。路由订阅自身的 transcript 和执行状态，在所选 Journey 改变时释放这些订阅，且不能为不存在的 Journey 渲染 composer。资料库和历史记录在没有活动 Session 时仍然可用。

### 迁移

实现先将当前 `ui-tavern` 的数据与产品组件同注册到 `tavern` 和 `conversation` slot 的代码分离。`ui-tavern-app` 随后在单一根节点下消费这些组件。Tavern bundle 仅为 Tavern profile 替换通用客户端页面清单；标准 dsh Web profile 保持现有应用不变。

由于这是展示所有权变更，持久化的 Session 和 Tavern 事件不变。既有 Journey 归档仍然是归档，而不是破坏性删除。只有在 Tavern 根应用已经渲染等价的资料库、Journey、历史、空白、加载和错误状态后，才移除旧 DOM 标记和通用 composer 隐藏规则。

## 考虑过的替代方案

**修补 `AppFrame` 使其理解 Tavern 的空状态。** 这会在通用外壳中为一个产品增加特例，而 `AppFrame`、通用 composer 和 Tavern 仍保留各自独立的生命周期。它只修复一个回退场景，根节点所有权仍然模糊。

**保留通用根节点并用 CSS 隐藏它。** 数据属性无法表达导航、失败、加载或 Session 可用性，并且它会随着需要它的 Tavern 视图一起消失。样式不能让两个根节点变成一个所有者。

**在通用根节点旁挂载第二个 Tavern 根节点。** 两个根节点会竞争页面空间、焦点、键盘快捷键、通知和全局 CSS。Tavern profile 应只有一个视觉根节点。

**构建外部独立 SPA。** 单独的服务会复制 dsh 浏览器启动、重连行为、流协议、Session 持久化和访问策略。提议中的应用在产品 UI 层独立，同时仍是 dsh 客户端组合。

## 验收标准

1. Tavern profile 恰好注册一个由 `ui-tavern-app` 拥有的视觉根节点；该 profile 中不挂载通用 Harness 布局、侧边栏、对话视图或 composer。
2. 首次访问以及没有选中 Session 的访问显示 Tavern 资料库，而不是通用 Harness 输入框或工作区页面。
3. 创建或打开 Journey 会选择 `journey` 路由，渲染其 Tavern transcript 和 composer，并使用宿主返回的权威 Journey id。
4. 成功归档活动 Journey 后回到 Tavern 资料库，清除所选 Journey，且绝不显示通用 Harness 界面。
5. 归档失败时保留活动 Journey 路由，并报告失败而不丢失 transcript 或 composer 状态。
6. 恢复或打开已归档 Journey 是明确的 Tavern 操作，回到 `journey` 路由；错误或不可用的路由 id 带产品通知回退到 Tavern 资料库。
7. Tavern 的导航或可见性行为不依赖 `document` 范围的数据属性、跨根节点 CSS 选择器或通用 UI store 的私有状态。
8. 测试覆盖首次使用资料库、活动 Journey 加载、归档成功转换、归档失败保留、恢复转换和陈旧路由回退。一项可运行的浏览器级检查证明归档活动 Journey 不会暴露通用 composer。

## 风险

自定义根节点一开始提供的通用客户端便利功能较少，因此每项需要的行为都必须明确保留为类型化的 dsh 基础能力，或重建为 Tavern 组件。过度复用通用组件会重新引入隐藏的导航和 Session 选择副作用；组件边界必须保持为展示用途。

Tavern 的产品路由可能暂时与异步 Session 投影不一致。根应用必须将宿主命令结果和刷新后的投影视为权威来源，明确展示加载或错误状态，且不能猜测替代 Journey。未来多标签页行为需要显式的同步策略，而不是另一个隐式的全局 store 回退。
