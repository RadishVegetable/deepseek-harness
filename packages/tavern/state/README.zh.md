# `@deepseek-ai/dsh-tavern-state`

[English](README.md) | 中文

用于 Tavern 结构化剧情状态的纯 TypeScript 值模型。它定义地点、时间、物品、健康、关系、修炼境界、有效誓言以及带命名空间扩展数据的 canonical JSON 记录。不导入 Cordis，不拥有持久化，也不修改 Session。

## 公共接口

运行时函数从包根入口导入；仅使用类型时从 `@deepseek-ai/dsh-tavern-state/types` 导入。

- `createStoryState(branchId)` 创建版本 1 的空状态。
- `sourceEventId(value)`、`storyBranchId(value)` 和 `storyEntityId(value)` 在拒绝空字符串后创建带品牌的 id。
- `projectStoryState(records, options)` 按追加顺序折叠选定分支谱系中的记录，并返回当前状态、已应用记录、拒绝记录和机器可读的问题。
- `compactPublicState(state)` 从模型可见状态中移除描述和扩展数据。
- `renderCompactPublicState(state)` 将紧凑状态输出为 JSON 文本。

每个 `StoryStateChangeRecord` 都保留 source event id、branch id、序列号、validity、authority、变更内容和扩展对象。较新的已接受更新会让同一逻辑槽位的旧记录失效，并写入 `supersededBy`；旧记录仍可用于重放和审计。

投影接受选定分支及其从根到选定分支的祖先记录。它会拒绝过期分支、重复 source event、非递增序列、非法记录、非法更新、显式标记为 invalid 的记录，以及权限更低的替换。authority 优先级为 `model-candidate < observed < authored-asset < user < gm`。

已知字段使用带 discriminant 的变更类型。其他持久化字段使用 `extension.set` 和 `extension.remove`；记录和已知值上的未知元数据保留在 `extensions` 中，用于无损传输。

## Model Experience

### 紧凑公共剧情状态

#### What the model sees

消费者可以把 `compactPublicState(state)` 序列化到 prompt 区段中，其中包含当前地点和时间、物品数量、健康摘要、关系、修炼值和有效誓言。本包的公共投影会排除描述、私有 owner 字段和全部扩展对象。

#### Token effect

长度取决于当前物品、健康、关系、修炼和誓言记录的数量，并移除冗余字段，但本包不分配 token 预算。

#### KV Cache effect

本包产生一个可替换的动态状态区段。任何紧凑字段变化都会改变该区段；稳定的前置 prompt 区段由 context compiler 负责。

## Known Limitations and Deferred Work

- **没有持久化适配器** - 调用方必须把记录追加到权威 Session 日志，并把确定性的记录序列传给纯投影函数。
- **没有观察者过滤** - 紧凑公共状态不判断 GM、玩家、旁白或角色是否可见；该策略属于 context 和 memory 包。
- **没有自动冲突合并** - 权限更低的记录会被拒绝，而不是静默合并；调用方必须追加新的权威修正记录。
