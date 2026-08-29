# @deepseek-ai/dsh-tavern-assets

English | [English](README.md)

用于角色卡和 World Book 的可序列化 Tavern 资源数据包。本包负责标准化资源记录、进程内 registry、选择校验和 prompt 资源 baseline 投影，不负责解析 JSON 或 PNG 文件。

## 接口

- `CharacterAsset` 保存标准化角色字段、原始来源数据、来源引用和扩展字段。
- `WorldInfoAsset` 保存标准化 World Book 条目、原始来源数据、来源引用和扩展字段。
- `AssetVersion` 标识来源格式和标准化修订号。
- `AssetSelection` 保存一个角色 ID 和有序 World Book ID 列表。
- `AssetRegistry` 注册两种资源，拒绝重复 ID 和空名称，列出独立快照并解析选择结果。
- `projectPromptAssetBaseline` 将已解析资源转换为带来源的角色段落和 World Book 激活候选。

兼容解析器保持在独立包中。`@deepseek-ai/dsh-tavern-compat` 可用时，它可以填充这些类型，而 registry 不依赖解析器行为。在此之前，适配器可使用 `sourceData` 和 `sourceReferences` 保存来源信息。

注册是进程内行为。`register()` 返回 disposer，读取结果返回独立的 JSON 兼容值，因此调用方不能通过返回对象修改 registry 快照。

## Model Experience

### 资源上下文

#### 模型看到的内容

Nothing directly. 本包只保存 Host 侧资源数据，不注册 prompt 段落、工具或模型 provider。后续 Tavern context compiler 可以消费 `PromptAssetBaseline` 并决定哪些 World Book 候选被激活。

#### Token 影响

Zero live-request tokens. 本包不组装或发送模型请求。

#### KV Cache 影响

None. 本包不创建请求前缀，也不访问 LLM provider。

## Known Limitations and Deferred Work

- 本包不包含角色卡 JSON/PNG parser、World Info importer、serializer、持久化 provider、session 集成、关键词激活、检索或 UI。
- prompt baseline 保留 World Book 条目作为候选，但不决定激活、概率、递归、深度、可见性或 token 预算。
- registry 只存在于进程内；要跨重启保留资源，需要接入持久化 provider。
