# `@deepseek-ai/dsh-tavern-context`

[English](README.md) | 中文

面向 Tavern 会话的纯 observer 感知上下文编译器。本包不依赖 Cordis、解析器、持久化、模型或文件系统。

## 接口

`compileContext()` 接受规范化的来源记录、当前 observer 和 branch、可选的规范化 World Info 条目，以及明确的字符数和 token 预算。它按 observer 范围、可见性、权限、branch 和有效性依次过滤；随后匹配合格的 World Info 条目，使用调用方提供的确定性 probability roll 做概率筛选，每个 group 只保留一个候选，再进行确定性排序、按 `source.key` 去重，并使用 first-fit 预算检查打包。depth、sticky 和 cooldown 会保留在规范化条目上，供有状态的 owner 使用；这个纯包不维护这些计时器。

`matchWorldInfo()` 是匹配入口。调用方提供带主关键词和次关键词的规范化条目；本包执行不区分大小写的 NFKC 规范化和整词匹配。主关键词命中优先于次关键词命中，之后依次按命中数、优先级和确定性的来源 key 排序。

结果包含 `stablePrefix` 和 `dynamicSuffix` 来源记录。它们的文本是模型可见内容，来源信息会保留在每条记录上。`ledger` 记录每次拒绝和纳入，包括 observer、可见性、权限、branch、有效性、未命中、重复和预算原因。设置 token 上限时必须提供 token estimator；该 estimator 也用于返回的用量和 ledger 条目。

## 模型体验

### 上下文记录

#### 模型看到的内容

按返回顺序拼接 `stablePrefix` 和 `dynamicSuffix` 的文本。本包不选择消息角色，也不序列化元数据；由所属 consumer 渲染选中的记录。

#### Token 影响

选中的来源文本消耗调用方提供的字符数和 token 预算。除非调用方提供 `tokenEstimator`，否则编译器不会估算 token。

#### KV Cache 影响

稳定记录单独返回，使 consumer 可以把它们放在可复用的请求前缀中。动态记录排在稳定记录之后，可以变化而不改变稳定记录顺序。

## 已知限制与后续工作

- World Info 解析、递归、持久化和激活事件写入由后续包负责。本 compiler 会处理显式概率和 group 选择，但不维护递归扫描或 sticky/cooldown 计时器。
- 整词匹配把字母、数字和下划线视为词字符；特定语言的分词不属于这个纯匹配器。
- 预算打包使用确定性的 first-fit；超过预算的记录会跳过，以便后面的较小记录仍有机会被选中。
