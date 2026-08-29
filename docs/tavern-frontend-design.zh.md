# Tavern 前端设计

[English](tavern-frontend-design.md) | 中文

本文定义 Tavern 角色扮演工作台的浏览器交互模型。运行时和持久化约定仍由 [`dsh-tavern-host`](../packages/tavern/host/README.md) 负责，共享 conversation 界面仍由 [`ui-conversation`](../packages/client/ui-conversation/README.md) 负责。

## 设计判断

Tavern 是面向角色扮演创作者的生产工具，用户会反复选择角色、检查注入上下文并撰写回合。界面采用专注的工作台语言：冷色中性表面、来自 DSW 主题的单一业务强调色、紧凑排版、可见状态和克制动效。

本设计使用 `DESIGN_VARIANCE: 4`、`MOTION_INTENSITY: 3` 和 `VISUAL_DENSITY: 6`。这些值让界面具有写作工具的辨识度，同时保证长会话中的扫描效率。

## 布局

Tavern surface 填满应用可用的中间栏，并让一个主要任务保持在视野内。

```text
Tavern bar: brand | connection state | session selector | new session

Character rail      Conversation stage                         Context rail
character identity  shared ChatView and shared Composer         active assets
session list        durable greeting and message flow           World Info entries
World Book list     no duplicate send path                       memory/state status
library and import  -------------------------------------------------------------
                    drawer: library editor or prompt inspector
```

角色栏保持窄且稳定。World Book 行展示条目数量、选择状态以及已保存和草稿之间的区别，不必先打开编辑器。对话工作区使用最大的列轨道，其中只放置唯一的 transcript 和 composer。上下文栏汇总当前提示词输入和最近一次记录的模型请求。

窄屏下隐藏上下文栏，角色和 World Info 栏压缩到对话上方。堆叠内容高于视口时，Tavern 主区独立滚动。对话工作区仍是首屏内容，打开抽屉不会卸载共享 ChatView 或 Composer。

## 交互模型

角色和 World Info 选择采用两步操作。控件先修改本地草稿，Apply 会追加一条 `tavern/assets-selected` 事件，Reset 会将草稿恢复为最近一次持久化选择。Apply 失败时保留草稿并显示行内错误。

资源抽屉负责源 JSON 编辑、导入和导出。Memory 和规范 Story State 控件也放在该抽屉中，因为它们会修改当前会话；Swipe 候选仍然是按会话生效的控制项。提示词检查器打开独立抽屉，读取记录的请求和带来源的 baseline，不在浏览器中重新计算 World Info 命中结果。

顶栏展示连接、会话和加载状态。会话列表等待、Tavern Remote 不可用、空会话和资源请求失败分别拥有独立的提示与恢复操作。首次资源请求期间使用与最终角色栏相同尺寸的骨架行。

## 视觉系统

功能 CSS 使用 CSS Modules 和 [`web-styling.md`](web-styling.md) 规定的 `--dsw-alias-*` 语义 token。页面使用一条圆角规则：工作台分区保持直角，`6px` 用于框定工具，只有语义状态点使用全圆。层次主要由边框和间距建立，阴影只用于打开的抽屉。

主操作使用主题业务强调色，次要操作使用层级和边框别名。图标按钮使用已有的 `dsh-client-ui-primitives` 图标族；不熟悉的操作提供原生 tooltip。所有交互状态都包含焦点可见性、减少动效、键盘导航和可读对比度。

## 归属和非目标

`ui-tavern` 负责活动抽屉、资源草稿和响应式栏显隐等呈现状态。`dsh-tavern-host` 负责资源存储、选择事件、Memory、Story State、Swipe 和提示词 baseline。`ui-conversation` 负责消息投影、草稿持久化、输入准入、流式输出、取消和传输。Tavern 不创建第二个聊天存储或发送链路。

工作台不包含群聊、场景编排、备用开场白选择、递归 World Info 编译、持久化 sticky/cooldown 计时器或 RAG。这些能力需要先拥有独立的运行时约定，再接收界面控件。

## 验收信号

- 首屏能表达当前角色、当前会话、连接状态、已选 World Info 和共享 composer。
- ChatView 和 Composer 仍是唯一的 transcript 与发送实现。
- 选择变更在 Apply 成功前明确显示为未保存。
- 提示词检查器展示记录的模型输入和来源标识，不伪造浏览器侧的命中结果。
- 空白、加载、错误、空资源、抽屉打开和窄屏布局都可用，文本和控件不重叠。
