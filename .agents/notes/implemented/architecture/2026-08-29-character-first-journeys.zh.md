# Agent Note: 角色优先、世界书附属的旅程

Status: implemented

[English](2026-08-29-character-first-journeys.md) | 中文

## 问题

Tavern Journey 需要先有一个玩家可以认识的人，再有一组玩家可以查看的 Lorebook。从世界开始会让第一次互动缺少关系锚点，也会让作者设定材料看起来像产品的主要对象。

## 决策

Tavern 浏览器从主角色卡开始创建 Journey。入口会预览其附属世界书，允许把独立世界书作为背景上下文加入，并且只有选中角色卡后才允许创建 Journey。描述人物的世界书条目会作为世界人物展示供查看，但不会创建角色 Agent 或独立模型调用。

Host 将内嵌的 `character_book` 标准化为角色卡拥有的 World Info 资产，将其加入所选 prompt baseline，并排除在独立 World Info 库之外。`selectForSession` 只将所选资源 ID 和玩家身份记录到 Session 日志；Journey 需要资源时，runtime 解析当前源记录。因此，资源库替换或删除会改变已有 ID Journey 能够解析的内容；源资源删除规则见 [Tavern 源资源生命周期](2026-09-02-tavern-source-asset-lifecycle.md)。

活动界面在角色、世界书和世界人物详情中展示源栏目以及动态的 `label: value` 栏目。`normalizeForSession` 会在有可用模型配置时将脱离的所选 baseline 发送给配置的模型，校验来源引用，并将接受的栏目以 `tavern/assets-normalized` 记录；没有模型路由、模型失败或输出无效时使用确定性的源栏目回退。Journey 事实会显示在对应的世界书或人物下，并可通过 Host 的追加式事件编辑或撤销。

历史旅程即使单个冷读取失败也会保留对应会话卡片；内容预览优先使用最新 assistant 消息，点击会直接带入已记录的 Journey 选择，删除则调用现有的注册表归档操作。归档会保留 Session 日志和 Workspace 记账席位。

## 考虑过的替代方案

**从世界开始。** 世界优先会在玩家还没有可交流对象时强调 Lorebook 广度。附属世界书仍支持大型设定，同时不让 World 成为 Journey 根对象。

**让世界拥有角色栏。** 这样会把可复用的 Lorebook 数据和特定角色阵容绑定。角色卡可以共享一个 World，而各个 Journey 独立发现人物。

**允许世界和角色任意独立作为根。** 独立根会削弱角色卡与附属上下文之间的作者关系，也会让开场不明确。选中主角色卡后，仍可有意识地增加额外世界书。

**每次玩家输入时整理资源。** 这样会在一次调用的叙事路径中增加第二次模型请求，并让显示准备成为故事生成的一部分。独立的选择时操作可以让每个玩家回合保持一次主要模型调用，并把结果与源资源分开记录。

## 后果

聚焦关系故事和大型设定故事使用同一条 GM 路径。共享来源资源不会共享 transcript、Journey 事实、分支或活动 baseline。主角色是设置锚点和导航目标，不是当前发言者锁定。

当前 Host 选择 API 仍允许空角色，以兼容底层资源测试；面向玩家的 Journey 入口要求选择角色卡。附属世界书匹配仍带来源记录，更丰富的 position、recursive、sticky、cooldown 和 selective 语义仍待实现。结构化整理是尽力而为的操作；没有模型路由时，Journey 仍使用确定性的栏目继续运行。

## 验证

客户端测试覆盖角色优先创建、仅浏览世界书时的入口行为、附属 Character Book、世界人物详情和动态源栏目。Host 测试覆盖内嵌 Character Book 投影、模型与回退结构化整理，以及资源库变化后的源选择解析。
