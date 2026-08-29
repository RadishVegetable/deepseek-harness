# Agent Note: Tavern 三栏工作台布局

Status: implemented

[English](2026-08-26-tavern-workbench-layout.md) | 中文

## Problem

Tavern client 已经提供多个角色扮演控件，但单一长页面会让资源选择、共享对话和提示词上下文相互争夺注意力。World Info 选择还需要可见的草稿状态，因为每次立即勾选都会改变持久化的提示词 baseline。

## Decision

Tavern surface 使用三栏工作台。角色栏负责当前角色、Tavern 会话列表、World Book 选择和条目数量。中间工作区渲染现有 ChatView 和由 ConversationRoot 负责的 Composer。上下文栏汇总所选 baseline、最近一次模型请求、Memory、Story State 和 Swipe 状态。

资源选择在本地暂存。角色和 World Info 控件先修改草稿；Apply 调用现有 Host Remote，只有选择事件成功后才更新已保存选择。Reset 恢复最近一次持久化选择。浏览器不计算可用于提示词判断的 World Info 命中；上下文栏读取记录的 baseline 和最近一次请求。

源编辑、导入导出、Memory、Story State、Swipe 和完整提示词检查器都在抽屉中显示。抽屉只是呈现状态，不会替换共享 transcript 或输入机。Tavern root slot 通过现有 Workspace service 提供连接/会话顶栏和新建会话操作。

工作台使用 CSS Modules、DSW 语义别名、现有基础图标族、稳定的直角框定和响应式抽屉行为。加载、空白、错误和空资源状态都留在 Tavern surface 内，因此连接不可用时不会只退回通用 conversation hero。

## Alternatives considered

**保留带锚点标签的长页面。** 这种方式把导航和文档滚动混在一起，并让 composer 远离上下文控件；三栏布局让下一次写作操作及其输入保持同时可见。

**创建 Tavern 专用 transcript 和 composer。** 这会重复 ChatView 投影、草稿持久化、输入准入、取消和传输；共享 ConversationRoot 仍是唯一归属方。

**每次勾选都立即持久化。** 这会让探索性选择具有破坏性，并可能在用户审阅之前追加多条 baseline；Apply 创建一次明确的持久化提交，Reset 保持本地可逆。

**在浏览器中重新计算 World Info 命中。** 浏览器没有 Host 的激活 ledger 和完整提示词组装上下文；显示本地命中数量可能与记录请求矛盾，因此检查器使用带来源的 baseline 数据。

## Consequences

首屏更适合反复进行角色扮演回合。移动布局用显式抽屉代替常驻侧栏，但对话仍是首要内容。Host Remote 和 Session log 仍是持久化行为的来源；选择失败时草稿会保留，便于修正。完整资源源 JSON 继续可用，字段级 World Info 编辑和图片持久化仍是独立的后续能力。
