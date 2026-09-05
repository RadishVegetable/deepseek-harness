# Agent Note: Tavern Journey 记忆系统设计

Status: proposed

[English](2026-09-02-tavern-journey-memory-system.md) | 中文

## Problem

Tavern Journey 需要一套能从 Session 日志重建的连续性事实视图，支持后台提取、分支编辑、提示词注入、检索和压缩；另建一份可变记忆文档会产生第二个事实来源，并使 fork 后的可见性、撤销和审计语义不清。

## Proposal

### 来源与所有权

`tavern/fact` 事件是 Journey 事实的追加式唯一来源；fold 视图、检索索引、资产清洗视图和注入快照都是派生数据，可以从日志重建。`@deepseek-ai/dsh-tavern-memory` 提供纯解析、入库、fold、索引、注入和压缩辅助能力，Host 负责模型路由、Session 接入、后台任务和可选的只读 `fact_search` 工具。

事实保留 `target`、`personId`、`subjectKey`、`authority`、`explicit`、来源和提取批次。`subjectKey` 是两级开放索引键，键无法归一时保留自然语言事实而不丢失内容；事实文本永远不由 fold 或整合过程改写。

### 提取生命周期

turn-end 提取在 `ctx.jobs` 中后台运行，不阻塞下一次 GM 请求；每个 Session 串行，跨 Session 并发。压缩轨只负责剧情梗概、未决伏笔和只包含关系的清理证据，不重复写入原子事实。

结构化输出必须通过完整批次校验；格式错误时整批丢弃且游标不推进。入库以 `(sessionId, span)` 幂等，保留来源事件、提取 id 和表态回合；成功追加 observed 事实后才推进游标。漏记可以从日志区间补提取，日志本身不依赖索引。

### 折叠与分支生命周期

`projectMemoryFacts()` 是 UI、注入和索引共同使用的唯一事实视图。相同 `subjectKey` 的事实按来源事件序列采用 freshness-first；玩家事实和显式观察不能被后续非显式观察静默压制，受保护的分歧保留为 conflict。被取代的记录仍留在日志和审计索引中。

事实可见性复用 Session 的 seed 前缀与当前分支规则。fork 不删除父分支事实，也不要求移动索引行；子分支只投影继承前缀和自身追加的记录。历史编辑、删除和重投必须由所属的 fork/regenerate 生命周期处理，尾部仅限文字润色的编辑可以沿用原地消息编辑并重新锚定提取结果。

### 提示词与检索

注入分为稳定角色设定区、历史 checkpoint 区和动态 Journey 事实区。动态快照记录精确的模型可见文本、事实序列和指纹；事实变化只重写动态区，保持稳定前缀可复用。`fact_search` 只用于长尾查证，预取和注入不得把当前请求已经可见的事实重复放入动态区。

资产导入保留原始 JSON，并生成带来源条目标识的规范视图；清洗失败时使用确定性回退并明确标记 `uncleaned`。主角静态设定与 Journey 动态事实分层，NPC 和世界条目通过现有激活及后续检索策略消费。

### 配置与接入

提取路由、窗口、压缩保留尾、编辑窗口、注入数量、检索模式和 checkpoint 预算都是校验后的配置。Host 在启动时拒绝违反保留尾与编辑窗口关系的配置；实现不得把部署可变阈值写成插件常量。

当前能力保留 GM `story` 加 `updates` 的兼容 wire path；结构化提取、SQLite 派生存储、真实 embedding、Tavern 专用压缩和完整记忆面板由后续接入逐项挂载。当前能力范围见 [Tavern Journey memory capability note](../../implemented/architecture/2026-09-03-tavern-journey-memory-capability.md)。

## Alternatives considered

**保存可变的 Journey 记忆文档：** 不采用，因为它会与 Session 日志竞争事实所有权，且需要另一套 fork、撤销和持久化协议。

**让 GM 直接写入事实更新 JSON：** 不采用，因为叙事响应与事实提取耦合，格式失败会污染主响应；后台结构化提取可以整批拒绝并重试。

**在 Host 内部实现全部记忆逻辑：** 不采用，因为资产清洗、fold、检索、注入和压缩需要共享同一套纯数据规则，不能依赖完整 Remote service。

**使用跨 Journey 的通用记忆库：** v1 不采用，因为 Journey 事实的分支可见性和 Session 证据属于 Tavern；跨旅程用户偏好属于独立的 dsh 记忆插件提案。

## Acceptance criteria

1. `tavern/fact` 是事实唯一来源，fold、索引和注入快照都能从日志重建。
2. turn-end 提取按 Session 串行、跨 Session 并发，失败批次不推进游标，重复区间不会重复入库。
3. `subjectKey` 折叠实现 freshness-first，并保留 user 与显式观察受到非显式观察保护的冲突。
4. fork 后的投影只包含 seed 前缀和当前分支记录，父分支事实不被删除或搬移。
5. 模型可见的动态记忆文本通过 Session 事件记录，稳定角色设定与动态事实分区渲染。
6. 原始 Tavern 资产保留，规范视图带来源追踪，清洗失败不阻塞导入。
7. 可变阈值由 validated Config 管理，保留尾不足编辑窗口时在启动阶段失败。
8. 真实组合快照最终覆盖提取、注入、分支编辑和压缩生命周期；尚未具备的快照证据在实现接入时补齐。

## Risks

后台提取可能漏记或误判，因而必须保留完整日志、来源和可重试游标；错误合并比重复记录更难恢复。异步更新会让下一次请求暂时看到上一轮视图，调用方必须接受最终一致性。静态前缀与动态注入分层增加了回放字段，压缩和派生索引不能取代原子事件。兼容 `updates` path 在迁移完成前会并存两套生产格式，后续切换必须保持事件和 fold 规则一致。
