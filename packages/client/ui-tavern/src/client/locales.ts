/** `tavern` namespace dictionaries for the roleplay surface. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'tavern'

/** The Tavern dictionary key set. */
export type TavernKey =
  | 'message.edit'
  | 'message.editInput'
  | 'message.editSave'
  | 'message.editCancel'
  | 'message.editFailed'
  | 'view.tavern'
  | 'navigation.title'
  | 'navigation.home'
  | 'navigation.story'
  | 'navigation.history'
  | 'asset.characterCard'
  | 'asset.worldInfo'
  | 'history.title'
  | 'history.subtitle'
  | 'history.loading'
  | 'history.loadFailed'
  | 'history.empty'
  | 'history.latest'
  | 'history.noContent'
  | 'history.lastPlayed'
  | 'history.open'
  | 'history.delete'
  | 'history.deleting'
  | 'history.deleteFailed'
  | 'status.title'
  | 'status.session'
  | 'status.mode'
  | 'status.messages'
  | 'status.requests'
  | 'status.tools'
  | 'status.cacheRead'
  | 'status.cacheWrite'
  | 'status.empty'
  | 'shell.starting'
  | 'shell.ready'
  | 'shell.noSession'
  | 'shell.brand'
  | 'shell.newSession'
  | 'shell.newJourney'
  | 'shell.retry'
  | 'drawer.close'
  | 'selection.unsaved'
  | 'selection.saved'
  | 'selection.reset'
  | 'selection.apply'
  | 'context.title'
  | 'context.assets'
  | 'context.noCharacter'
  | 'context.noWorldInfo'
  | 'context.baselineEntries'
  | 'context.runtime'
  | 'context.lastRequest'
  | 'context.noRequest'
  | 'prompt.title'
  | 'prompt.empty'
  | 'prompt.openTrajectory'
  | 'prompt.system'
  | 'prompt.tools'
  | 'prompt.noTools'
  | 'prompt.worldInfo'
  | 'prompt.noWorldInfo'
  | 'prompt.sources'
  | 'prompt.noSources'
  | 'prompt.constant'
  | 'prompt.latest'
  | 'prompt.request'
  | 'prompt.turn'
  | 'prompt.step'
  | 'prompt.start'
  | 'prompt.status'
  | 'prompt.statusRunning'
  | 'prompt.statusComplete'
  | 'prompt.statusError'
  | 'prompt.provider'
  | 'prompt.model'
  | 'prompt.result'
  | 'prompt.noResult'
  | 'prompt.output'
  | 'prompt.outputRecorded'
  | 'prompt.outputUnavailable'
  | 'prompt.resultRecorded'
  | 'prompt.usage'
  | 'prompt.noUsage'
  | 'prompt.error'
  | 'prompt.unknown'
  | 'prompt.noPrompt'
  | 'prompt.gmResponse'
  | 'prompt.noGmResponse'
  | 'prompt.gmEvent'
  | 'prompt.assistant'
  | 'prompt.parsedStory'
  | 'prompt.parsedUpdates'
  | 'prompt.noUpdates'
  | 'prompt.activation'
  | 'prompt.noActivation'
  | 'prompt.included'
  | 'prompt.excluded'
  | 'prompt.reason'
  | 'prompt.matchedKeys'
  | 'prompt.attempted'
  | 'prompt.accepted'
  | 'prompt.ledgerUsage'
  | 'prompt.characters'
  | 'prompt.tokens'
  | 'prompt.reasonIncluded'
  | 'prompt.reasonObserver'
  | 'prompt.reasonVisibility'
  | 'prompt.reasonAuthority'
  | 'prompt.reasonBranch'
  | 'prompt.reasonInvalid'
  | 'prompt.reasonNotMatched'
  | 'prompt.reasonGroup'
  | 'prompt.reasonDuplicate'
  | 'prompt.reasonBudgetCharacters'
  | 'prompt.reasonBudgetTokens'
  | 'prompt.reasonBudgetBoth'
  | 'library.title'
  | 'library.character'
  | 'library.characterSelect'
  | 'library.worldInfo'
  | 'library.import'
  | 'library.noCharacter'
  | 'library.noWorldInfo'
  | 'library.none'
  | 'library.entries'
  | 'library.selected'
  | 'library.localOnly'
  | 'library.hostManaged'
  | 'library.loading'
  | 'library.loadFailed'
  | 'library.operationFailed'
  | 'library.deleteUnavailable'
  | 'library.invalid'
  | 'library.saving'
  | 'library.saved'
  | 'library.notSelected'
  | 'library.active'
  | 'workspace.title'
  | 'workspace.character'
  | 'workspace.noCharacter'
  | 'workspace.greeting'
  | 'workspace.greetingHint'
  | 'workspace.recent'
  | 'workspace.noMessages'
  | 'workspace.transcript'
  | 'workspace.world'
  | 'workspace.worldNone'
  | 'workspace.mode'
  | 'workspace.direct'
  | 'entrance.kicker'
  | 'entrance.title'
  | 'entrance.subtitle'
  | 'entrance.characters'
  | 'entrance.characterPreview'
  | 'entrance.attachedBook'
  | 'entrance.noAttachedBook'
  | 'entrance.independentBooks'
  | 'entrance.independentBooksNote'
  | 'entrance.heroLabel'
  | 'entrance.playerIdentity'
  | 'entrance.playerIdentityPlaceholder'
  | 'entrance.playerIdentityHint'
  | 'entrance.start'
  | 'entrance.starting'
  | 'entrance.startTimeout'
  | 'entrance.startFailed'
  | 'journey.current'
  | 'journey.tools'
  | 'journey.settings'
  | 'journey.details'
  | 'journey.chronicle'
  | 'journey.audit'
  | 'journey.ledger'
  | 'journey.ledgerEmpty'
  | 'journey.sectionName'
  | 'journey.addSection'
  | 'journey.saveSection'
  | 'journey.reorderSection'
  | 'journey.renameSection'
  | 'journey.deleteSection'
  | 'journey.conflict'
  | 'journey.conflictChanged'
  | 'journey.conflictRecorded'
  | 'journey.keepNew'
  | 'journey.dropNew'
  | 'journey.undo'
  | 'journey.people'
  | 'journey.noPeople'
  | 'journey.noCharacter'
  | 'journey.world'
  | 'journey.editWorld'
  | 'journey.noWorld'
  | 'journey.sceneAlt'
  | 'journey.deleteCurrent'
  | 'journey.deleteCurrentHint'
  | 'journey.deleteCurrentConfirm'
  | 'journey.deleted'
  | 'journey.sceneLabel'
  | 'journey.sceneName'
  | 'journey.sceneSummary'
  | 'journey.portraitAlt'
  | 'journey.memory'
  | 'journey.storyState'
  | 'journey.swipes'
  | 'settings.model.kicker'
  | 'settings.model.title'
  | 'settings.model.description'
  | 'settings.model.unavailable'
  | 'character.details'
  | 'character.description'
  | 'character.personality'
  | 'character.scenario'
  | 'character.notes'
  | 'character.book'
  | 'character.noDescription'
  | 'world.details'
  | 'world.entries'
  | 'world.content'
  | 'world.enabled'
  | 'world.disabled'
  | 'person.details'
  | 'person.worldEntry'
  | 'person.journeyEntry'
  | 'person.aliases'
  | 'person.description'
  | 'person.source'
  | 'conversation.title'
  | 'editor.title'
  | 'editor.export'
  | 'editor.exported'
  | 'editor.save'
  | 'editor.delete'
  | 'editor.deleteConfirm'
  | 'editor.deleted'
  | 'editor.saved'
  | 'editor.invalid'
  | 'editor.sourceJson'
  | 'editor.characterSelect'
  | 'editor.worldSelect'
  | 'editor.noCharacter'
  | 'editor.noWorldInfo'
  | 'editor.noAssets'
  | 'facts.title'
  | 'facts.empty'
  | 'facts.autoOnly'
  | 'facts.editHint'
  | 'facts.value'
  | 'facts.editValue'
  | 'facts.editInput'
  | 'facts.untitled'
  | 'facts.sourceAsset'
  | 'facts.sourceAssistant'
  | 'facts.sourceUser'
  | 'facts.sourceSystem'
  | 'facts.edit'
  | 'facts.save'
  | 'facts.remove'
  | 'facts.saved'
  | 'facts.removed'
  | 'facts.undo'
  | 'facts.undone'
  | 'facts.undoUnavailable'
  | 'facts.conflict'
  | 'facts.keepNew'
  | 'facts.keepOld'
  | 'facts.keptNew'
  | 'facts.keptOld'
  | 'facts.audit'
  | 'facts.auditEmpty'
  | 'facts.accepted'
  | 'facts.rejected'
  | 'facts.operationAdd'
  | 'facts.operationReplace'
  | 'facts.operationRemove'
  | 'facts.targetPeople'
  | 'facts.targetWorld'
  | 'story.title'
  | 'story.location'
  | 'story.time'
  | 'story.id'
  | 'story.name'
  | 'story.description'
  | 'story.value'
  | 'story.calendar'
  | 'story.timezone'
  | 'story.save'
  | 'story.issues'
  | 'swipe.title'
  | 'swipe.note'
  | 'swipe.empty'
  | 'swipe.candidates'
  | 'swipe.emptyCandidate'
  | 'swipe.previous'
  | 'swipe.next'
  | 'swipe.regenerate'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Tavern roleplay surface copy. */
    tavern: TavernKey
  }
}

/** Simplified Chinese dictionary. */
export const zh: Record<TavernKey, string> = {
  'message.edit': '编辑消息',
  'message.editInput': '编辑消息内容',
  'message.editSave': '保存编辑',
  'message.editCancel': '取消编辑',
  'message.editFailed': '编辑失败',
  'navigation.home': '首页',
  'entrance.startTimeout': '开启旅程超时，请重试。',
  'entrance.startFailed': '开启旅程失败，请检查选择后重试。',
  'editor.delete': '删除',
  'editor.deleteConfirm': '确认删除',
  'editor.deleted': '已删除。',
  'workspace.title': '酒馆角色扮演旅程',
  'workspace.character': '当前角色',
  'workspace.noCharacter': '选择一张角色卡，开始角色扮演会话。',
  'workspace.greeting': '开场白',
  'workspace.greetingHint': '这是角色卡中的开场内容；下一条消息会通过持久化会话发送。',
  'workspace.recent': '角色扮演',
  'workspace.noMessages': '还没有角色扮演消息。',
  'workspace.transcript': '持久化会话记录',
  'workspace.world': '当前会话的世界书',
  'workspace.worldNone': '未选择世界书。',
  'workspace.mode': '交互模式',
  'workspace.direct': '老酒馆 · 故事旅程',
  'entrance.kicker': '开始一段故事',
  'entrance.title': '先遇见一个人，再走进他的世界。',
  'entrance.subtitle': '选择一张角色卡作为旅程的起点。角色卡中的设定会陪你进入每一次新的聊天。',
  'entrance.characters': '选择角色卡',
  'entrance.characterPreview': '角色简介',
  'entrance.attachedBook': '角色附属世界书',
  'entrance.noAttachedBook': '这张角色卡没有附属世界书。',
  'entrance.independentBooks': '可选世界书',
  'entrance.independentBooksNote': '独立世界书只提供背景条目，不会代替角色卡成为旅程入口。',
  'entrance.heroLabel': '今晚的故事从这里开始',
  'entrance.playerIdentity': '你的身份',
  'entrance.playerIdentityPlaceholder': '给自己一个名字或身份',
  'entrance.playerIdentityHint': '可选。它会成为故事中 GM 称呼你的方式。',
  'entrance.start': '开始旅程',
  'entrance.starting': '正在开启旅程…',
  'journey.current': '当前旅程',
  'journey.tools': '旅程工具',
  'journey.settings': '旅程设置',
  'journey.details': '旅程中的人和世界',
  'journey.chronicle': '旅志',
  'journey.audit': '查看事实审计',
  'journey.ledger': '旅志栏目',
  'journey.ledgerEmpty': '选择角色卡或世界书后，旅志会在这里出现。',
  'journey.sectionName': '栏目名称',
  'journey.addSection': '新增栏目',
  'journey.saveSection': '保存栏目',
  'journey.reorderSection': '拖动排序栏目',
  'journey.renameSection': '重命名栏目',
  'journey.deleteSection': '删除栏目',
  'journey.conflict': '事实冲突',
  'journey.conflictChanged': '新设定与当前事实不一致。',
  'journey.conflictRecorded': '冲突已记录，可在审计中查看。',
  'journey.keepNew': '保留新值',
  'journey.dropNew': '抛弃新值',
  'journey.undo': '撤销上次操作',
  'journey.people': '世界人物',
  'journey.noPeople': '当前世界书没有可识别的人物条目。',
  'journey.noCharacter': '尚未选择角色',
  'journey.world': '世界观',
  'journey.editWorld': '编辑世界内容',
  'journey.noWorld': '当前旅程还没有额外世界书。',
  'journey.sceneAlt': '酒馆夜雨中的故事场景',
  'journey.deleteCurrent': '删除这段旅程',
  'journey.deleteCurrentHint': '删除后会回到首页，这段旅程将从历史中移除，且无法恢复。',
  'journey.deleteCurrentConfirm': '再点一次确认删除',
  'journey.deleted': '旅程已删除。',
  'journey.sceneLabel': '当前场景',
  'journey.sceneName': '咸风角酒馆',
  'journey.sceneSummary': '临海的小酒馆，木门吱呀作响，烛火在雨夜里摇曳。',
  'journey.portraitAlt': '当前角色立绘',
  'journey.memory': '记忆',
  'journey.storyState': '剧情状态',
  'journey.swipes': '候选回复',
  'settings.model.kicker': '生成设置',
  'settings.model.title': '叙事模型',
  'settings.model.description': '选择本次旅程使用的模型与推理等级。这里的设置只影响后续剧情生成。',
  'settings.model.unavailable': '当前会话暂时没有可用的模型选择。',
  'character.details': '角色详情',
  'character.description': '简介',
  'character.personality': '性格',
  'character.scenario': '场景',
  'character.notes': '创作者备注',
  'character.book': '附属世界书',
  'character.noDescription': '这张角色卡还没有简介。',
  'world.details': '世界书详情',
  'world.entries': '条目',
  'world.content': '内容',
  'world.enabled': '已启用',
  'world.disabled': '已停用',
  'person.details': '人物详情',
  'person.worldEntry': '来自世界书的人物条目',
  'person.journeyEntry': '由当前旅程事实创建',
  'person.aliases': '别名与关键词',
  'person.description': '世界书条目',
  'person.source': '来源世界书',
  'conversation.title': '角色扮演对话',
  'editor.title': '资源编辑与导出',
  'editor.export': '导出 JSON',
  'editor.exported': '已开始下载 JSON。',
  'editor.save': '保存资源',
  'editor.saved': '资源已保存。',
  'editor.invalid': '资源 JSON 无效或保存失败。',
  'editor.sourceJson': '源 JSON',
  'editor.characterSelect': '选择角色卡',
  'editor.worldSelect': '选择世界书',
  'editor.noCharacter': '当前没有选择角色卡。',
  'editor.noWorldInfo': '当前没有世界书。',
  'editor.noAssets': '还没有可编辑的酒馆资源。',
  'facts.title': '剧情事实',
  'facts.empty': '当前旅程还没有自动记录的事实。',
  'facts.autoOnly': '由主持人自动写入；可以修改或撤销。',
  'facts.editHint': '查看并修正当前旅程的事实',
  'facts.value': '事实',
  'facts.editValue': '编辑事实',
  'facts.editInput': '事实内容',
  'facts.untitled': '未命名栏目',
  'facts.sourceAsset': '资源',
  'facts.sourceAssistant': '助手',
  'facts.sourceUser': '玩家',
  'facts.sourceSystem': '系统',
  'facts.edit': '修改',
  'facts.save': '保存修改',
  'facts.remove': '撤销',
  'facts.saved': '事实已保存。',
  'facts.removed': '事实已撤销，可尝试恢复。',
  'facts.undo': '撤销上次操作',
  'facts.undone': '已撤销上次操作。',
  'facts.undoUnavailable': '当前服务不支持恢复已撤销事实，请从审计记录查看原始变更。',
  'facts.conflict': '发现设定冲突',
  'facts.keepNew': '保留新值',
  'facts.keepOld': '保留旧值',
  'facts.keptNew': '已保留新值',
  'facts.keptOld': '已保留旧值',
  'facts.audit': '事实审查记录',
  'facts.auditEmpty': '还没有事实事件记录。',
  'facts.accepted': '已接受',
  'facts.rejected': '已拒绝',
  'facts.operationAdd': '新增',
  'facts.operationReplace': '替换',
  'facts.operationRemove': '撤销',
  'facts.targetPeople': '人物',
  'facts.targetWorld': '世界',
  'story.title': '剧情状态',
  'story.location': '位置',
  'story.time': '时间',
  'story.id': '标识',
  'story.name': '名称',
  'story.description': '描述',
  'story.value': '时间值',
  'story.calendar': '日历',
  'story.timezone': '时区',
  'story.save': '保存状态',
  'story.issues': '投影问题',
  'swipe.title': '候选回复',
  'swipe.note': '持久化的助手候选',
  'swipe.empty': '当前还没有记录助手候选。',
  'swipe.candidates': '个候选',
  'swipe.emptyCandidate': '空的候选回复',
  'swipe.previous': '上一个候选',
  'swipe.next': '下一个候选',
  'swipe.regenerate': '重新生成',
  'view.tavern': '酒馆',
  'navigation.title': '旅程导航',
  'navigation.story': '故事旅程',
  'navigation.history': '历史旅程',
  'asset.characterCard': '角色卡',
  'asset.worldInfo': '世界书',
  'history.title': '历史旅程',
  'history.subtitle': '回到你走过的每一段故事。',
  'history.loading': '正在整理历史旅程...',
  'history.loadFailed': '部分历史旅程暂时无法读取。',
  'history.empty': '还没有完成的旅程。',
  'history.latest': '最后内容',
  'history.noContent': '这段旅程还没有可展示的内容。',
  'history.lastPlayed': '最后游玩',
  'history.open': '进入旅程',
  'history.delete': '删除旅程',
  'history.deleting': '正在删除',
  'history.deleteFailed': '删除旅程失败，原记录仍然保留。',
  'status.title': '运行状态',
  'status.session': '会话',
  'status.mode': '模式',
  'status.messages': '消息',
  'status.requests': '模型请求',
  'status.tools': '工具',
  'status.cacheRead': '缓存读取',
  'status.cacheWrite': '缓存写入',
  'status.empty': '尚未选择会话',
  'shell.starting': '正在连接',
  'shell.ready': '已就绪',
  'shell.noSession': '暂无酒馆会话',
  'shell.brand': '酒馆',
  'shell.newSession': '新建会话',
  'shell.newJourney': '新旅程',
  'shell.retry': '重试',
  'drawer.close': '关闭面板',
  'selection.unsaved': '有未保存选择',
  'selection.saved': '选择已保存',
  'selection.reset': '重置',
  'selection.apply': '应用选择',
  'context.title': '上下文',
  'context.assets': '当前资源',
  'context.noCharacter': '未选择角色卡。',
  'context.noWorldInfo': '未选择世界书。',
  'context.baselineEntries': '初始资料条目',
  'context.runtime': '运行状态',
  'context.lastRequest': '最近请求',
  'context.noRequest': '尚未记录模型请求。',
  'prompt.title': '提示词检查',
  'prompt.empty': '当前会话还没有已记录的模型请求。',
  'prompt.openTrajectory': '在请求轨迹中查看完整请求',
  'prompt.system': '系统提示词',
  'prompt.tools': '工具',
  'prompt.noTools': '这次请求没有记录工具。',
  'prompt.worldInfo': '世界书',
  'prompt.noWorldInfo': '当前选择中没有可用的世界书条目。',
  'prompt.sources': '来源',
  'prompt.noSources': '没有记录酒馆资源来源。',
  'prompt.constant': '常量条目',
  'prompt.latest': '最近一次请求',
  'prompt.request': '请求',
  'prompt.turn': '回合',
  'prompt.step': '步骤',
  'prompt.start': '请求序号',
  'prompt.status': '状态',
  'prompt.statusRunning': '运行中',
  'prompt.statusComplete': '已完成',
  'prompt.statusError': '错误',
  'prompt.provider': '服务提供方',
  'prompt.model': '模型',
  'prompt.result': '结果序号',
  'prompt.noResult': '未记录',
  'prompt.output': '助手输出',
  'prompt.outputRecorded': '已记录的助手正文',
  'prompt.outputUnavailable': '当前请求视图只提供请求状态与结果序号，不包含助手正文；正文仍显示在对话流中。',
  'prompt.resultRecorded': '已记录结果',
  'prompt.usage': '用量',
  'prompt.noUsage': '这次请求没有记录用量。',
  'prompt.error': '错误信息',
  'prompt.unknown': '未知',
  'prompt.noPrompt': '这次请求没有记录完整的提示词快照。',
  'prompt.gmResponse': 'GM 响应解析',
  'prompt.noGmResponse': '当前会话没有可审查的主持人响应包。',
  'prompt.gmEvent': '响应事件',
  'prompt.assistant': '助手消息',
  'prompt.parsedStory': '解析后的剧情正文',
  'prompt.parsedUpdates': '解析后的事实更新',
  'prompt.noUpdates': '这次响应没有携带事实更新。',
  'prompt.activation': '上下文激活决策',
  'prompt.noActivation': '当前会话还没有上下文激活记录。',
  'prompt.included': '已激活',
  'prompt.excluded': '未激活',
  'prompt.reason': '原因',
  'prompt.matchedKeys': '命中关键词',
  'prompt.attempted': '尝试用量',
  'prompt.accepted': '接收用量',
  'prompt.ledgerUsage': '总用量',
  'prompt.characters': '字符',
  'prompt.tokens': '令牌',
  'prompt.reasonIncluded': '通过筛选',
  'prompt.reasonObserver': '观察者范围不允许',
  'prompt.reasonVisibility': '可见性不允许',
  'prompt.reasonAuthority': '权威级别不允许',
  'prompt.reasonBranch': '不属于当前分支',
  'prompt.reasonInvalid': '来源无效',
  'prompt.reasonNotMatched': '没有命中关键词',
  'prompt.reasonGroup': '被激活组排除',
  'prompt.reasonDuplicate': '重复来源',
  'prompt.reasonBudgetCharacters': '超出字符预算',
  'prompt.reasonBudgetTokens': '超出令牌预算',
  'prompt.reasonBudgetBoth': '同时超出字符和令牌预算',
  'library.title': '酒馆资源库',
  'library.character': '角色卡',
  'library.characterSelect': '当前角色',
  'library.worldInfo': '世界书',
  'library.import': '导入 JSON 或 PNG',
  'library.noCharacter': '还没有导入角色卡。',
  'library.noWorldInfo': '还没有导入世界书。',
  'library.none': '不选择角色',
  'library.entries': '条目',
  'library.selected': '已选择',
  'library.localOnly': '本地草稿；点击“应用选择”后写入当前会话。',
  'library.hostManaged': '资源由主机管理；导入源会保存在当前进程中。',
  'library.loading': '正在加载酒馆资源...',
  'library.loadFailed': '酒馆资源暂时无法加载，请稍后重试。',
  'library.operationFailed': '酒馆操作失败，请稍后重试。',
  'library.deleteUnavailable': '当前环境不支持删除资源。',
  'library.invalid': '无法导入这个 JSON 或 PNG 文件。',
  'library.saving': '正在保存到当前会话...',
  'library.saved': '选择已记录到当前会话。',
  'library.notSelected': '选择角色卡或世界书以启用酒馆提示词链路。',
  'library.active': '已匹配条目',
}

/** English dictionary. */
export const en: Record<TavernKey, string> = {
  'message.edit': 'Edit message',
  'message.editInput': 'Message text',
  'message.editSave': 'Save edit',
  'message.editCancel': 'Cancel edit',
  'message.editFailed': 'Edit failed',
  'navigation.home': 'Home',
  'entrance.startTimeout': 'Starting the journey timed out. Please try again.',
  'entrance.startFailed': 'Could not start the journey. Check your selection and try again.',
  'editor.delete': 'Delete',
  'editor.deleteConfirm': 'Delete asset',
  'editor.deleted': 'Asset deleted.',
  'workspace.title': 'Tavern roleplay journey',
  'workspace.character': 'Current character',
  'workspace.noCharacter': 'Select a Character Card to start a roleplay session.',
  'workspace.greeting': 'Opening greeting',
  'workspace.greetingHint': 'This greeting is the character card opening. Your next message is sent through the durable conversation session.',
  'workspace.recent': 'Roleplay',
  'workspace.noMessages': 'No roleplay messages yet.',
  'workspace.transcript': 'Durable conversation transcript',
  'workspace.world': 'World Info in this session',
  'workspace.worldNone': 'No World Info selected.',
  'workspace.mode': 'Interaction mode',
  'workspace.direct': 'Old Tavern · Story Journey',
  'entrance.kicker': 'TAVERN / BEGIN A STORY',
  'entrance.title': 'Meet someone first. Then enter their world.',
  'entrance.subtitle': 'Choose a Character Card as the beginning of your Journey. Its authored setting follows you into every new chat.',
  'entrance.characters': 'Choose a Character Card',
  'entrance.characterPreview': 'Character preview',
  'entrance.attachedBook': 'Attached Character Book',
  'entrance.noAttachedBook': 'This Character Card has no attached World Book.',
  'entrance.independentBooks': 'Optional World Books',
  'entrance.independentBooksNote': 'Independent World Books add background entries; they do not replace the Character Card as the Journey anchor.',
  'entrance.heroLabel': 'Tonight\'s story begins here',
  'entrance.playerIdentity': 'Your identity',
  'entrance.playerIdentityPlaceholder': 'Give yourself a name or role',
  'entrance.playerIdentityHint': 'Optional. The GM will use it when addressing you in the story.',
  'entrance.start': 'Begin Journey',
  'entrance.starting': 'Starting journey…',
  'journey.current': 'Current Journey',
  'journey.tools': 'Journey tools',
  'journey.settings': 'Journey settings',
  'journey.details': 'People and world',
  'journey.chronicle': 'Journey chronicle',
  'journey.audit': 'Open fact audit',
  'journey.ledger': 'Journey ledger',
  'journey.ledgerEmpty': 'Choose a Character Card or World Book to populate the ledger.',
  'journey.sectionName': 'Column name',
  'journey.addSection': 'Add column',
  'journey.saveSection': 'Save column',
  'journey.reorderSection': 'Reorder column',
  'journey.renameSection': 'Rename column',
  'journey.deleteSection': 'Delete column',
  'journey.conflict': 'Fact conflict',
  'journey.conflictChanged': 'The new setting differs from the current fact.',
  'journey.conflictRecorded': 'The conflict is recorded in the audit.',
  'journey.keepNew': 'Keep new value',
  'journey.dropNew': 'Discard new value',
  'journey.undo': 'Undo last action',
  'journey.people': 'People in this world',
  'journey.noPeople': 'No character entries were identified in the active World Books.',
  'journey.noCharacter': 'No character selected',
  'journey.world': 'World',
  'journey.editWorld': 'Edit world content',
  'journey.noWorld': 'No additional World Books are attached to this Journey.',
  'journey.sceneAlt': 'A rainy tavern scene',
  'journey.deleteCurrent': 'Delete this journey',
  'journey.deleteCurrentHint': 'Deleting returns to the home page; this journey is removed from history and cannot be recovered.',
  'journey.deleteCurrentConfirm': 'Click again to confirm',
  'journey.deleted': 'Journey deleted.',
  'journey.sceneLabel': 'Current scene',
  'journey.sceneName': 'Saltwind Tavern',
  'journey.sceneSummary': 'A seaside tavern where the wooden door creaks and candlelight trembles in the rain.',
  'journey.portraitAlt': 'Current character portrait',
  'journey.memory': 'Memory',
  'journey.storyState': 'Story state',
  'journey.swipes': 'Reply candidates',
  'settings.model.kicker': 'GENERATION',
  'settings.model.title': 'Narrative model',
  'settings.model.description': 'Choose the model and reasoning effort for this Journey. The setting applies to future story generation.',
  'settings.model.unavailable': 'No model selection is available for this session yet.',
  'character.details': 'Character details',
  'character.description': 'Description',
  'character.personality': 'Personality',
  'character.scenario': 'Scenario',
  'character.notes': 'Creator notes',
  'character.book': 'Attached World Book',
  'character.noDescription': 'This Character Card has no description yet.',
  'world.details': 'World Book details',
  'world.entries': 'entries',
  'world.content': 'Content',
  'world.enabled': 'Enabled',
  'world.disabled': 'Disabled',
  'person.details': 'Person details',
  'person.worldEntry': 'Character entry from a World Book',
  'person.journeyEntry': 'Created from current Journey facts',
  'person.aliases': 'Aliases and keywords',
  'person.description': 'World Book entry',
  'person.source': 'Source World Book',
  'conversation.title': 'Roleplay conversation',
  'editor.title': 'Asset editor and export',
  'editor.export': 'Export JSON',
  'editor.exported': 'JSON download started.',
  'editor.save': 'Save asset',
  'editor.saved': 'Asset saved.',
  'editor.invalid': 'The asset JSON is invalid or could not be saved.',
  'editor.sourceJson': 'Source JSON',
  'editor.characterSelect': 'Select Character Card',
  'editor.worldSelect': 'Select World Info',
  'editor.noCharacter': 'No Character Card is selected.',
  'editor.noWorldInfo': 'No World Info is available.',
  'editor.noAssets': 'No Tavern assets are available to edit.',
  'facts.title': 'Story facts',
  'facts.empty': 'No automatic facts have been recorded in this Journey.',
  'facts.autoOnly': 'Written by the GM; you can edit or revoke them.',
  'facts.editHint': 'Inspect and correct facts for this Journey',
  'facts.value': 'Fact',
  'facts.editValue': 'Edit fact',
  'facts.editInput': 'Fact text',
  'facts.untitled': 'Untitled column',
  'facts.sourceAsset': 'Asset',
  'facts.sourceAssistant': 'Assistant',
  'facts.sourceUser': 'Player',
  'facts.sourceSystem': 'System',
  'facts.edit': 'Edit',
  'facts.save': 'Save edit',
  'facts.remove': 'Revoke',
  'facts.saved': 'Fact saved.',
  'facts.removed': 'Fact revoked. Recovery may be available.',
  'facts.undo': 'Undo last action',
  'facts.undone': 'Last action undone.',
  'facts.undoUnavailable': 'This service cannot restore a revoked fact. The original change remains in the audit.',
  'facts.conflict': 'Setting conflict detected',
  'facts.keepNew': 'Keep new value',
  'facts.keepOld': 'Keep old value',
  'facts.keptNew': 'New value kept.',
  'facts.keptOld': 'Old value kept.',
  'facts.audit': 'Fact audit records',
  'facts.auditEmpty': 'No fact events have been recorded.',
  'facts.accepted': 'Accepted',
  'facts.rejected': 'Rejected',
  'facts.operationAdd': 'Added',
  'facts.operationReplace': 'Replaced',
  'facts.operationRemove': 'Revoked',
  'facts.targetPeople': 'People',
  'facts.targetWorld': 'World',
  'story.title': 'Story State',
  'story.location': 'Location',
  'story.time': 'Time',
  'story.id': 'ID',
  'story.name': 'Name',
  'story.description': 'Description',
  'story.value': 'Time value',
  'story.calendar': 'Calendar',
  'story.timezone': 'Timezone',
  'story.save': 'Save state',
  'story.issues': 'Projection issues',
  'view.tavern': 'Tavern',
  'navigation.title': 'Journey navigation',
  'navigation.story': 'Story Journey',
  'navigation.history': 'Journey History',
  'asset.characterCard': 'Character Card',
  'asset.worldInfo': 'World Info',
  'history.title': 'Journey history',
  'history.subtitle': 'Return to any story you have already played.',
  'history.loading': 'Organizing journey history...',
  'history.loadFailed': 'Some journeys are temporarily unavailable.',
  'history.empty': 'No completed journeys yet.',
  'history.latest': 'Latest content',
  'history.noContent': 'This journey has no content to preview yet.',
  'history.lastPlayed': 'Last played',
  'history.open': 'Open journey',
  'history.delete': 'Delete journey',
  'history.deleting': 'Deleting',
  'history.deleteFailed': 'Could not delete this journey. The record is still kept.',
  'status.title': 'Runtime status',
  'status.session': 'Session',
  'status.mode': 'Mode',
  'status.messages': 'Messages',
  'status.requests': 'Model requests',
  'status.tools': 'Tools',
  'status.cacheRead': 'Cache read',
  'status.cacheWrite': 'Cache write',
  'status.empty': 'No session selected',
  'shell.starting': 'Connecting',
  'shell.ready': 'Ready',
  'shell.noSession': 'No Tavern session',
  'shell.brand': 'Tavern',
  'shell.newSession': 'New session',
  'shell.newJourney': 'New Journey',
  'shell.retry': 'Retry',
  'drawer.close': 'Close panel',
  'selection.unsaved': 'Unsaved selection',
  'selection.saved': 'Selection saved',
  'selection.reset': 'Reset',
  'selection.apply': 'Apply selection',
  'context.title': 'Context',
  'context.assets': 'Active assets',
  'context.noCharacter': 'No Character Card selected.',
  'context.noWorldInfo': 'No World Info selected.',
  'context.baselineEntries': 'Baseline entries',
  'context.runtime': 'Runtime status',
  'context.lastRequest': 'Latest request',
  'context.noRequest': 'No model request recorded yet.',
  'prompt.title': 'Prompt inspection',
  'prompt.empty': 'No model request has been recorded for this session.',
  'prompt.openTrajectory': 'View the full request in Trajectory',
  'prompt.system': 'System prompt',
  'prompt.tools': 'Tools',
  'prompt.noTools': 'No tools were recorded for this request.',
  'prompt.worldInfo': 'World Info',
  'prompt.noWorldInfo': 'No World Info entries are available in the selected baseline.',
  'prompt.sources': 'Sources',
  'prompt.noSources': 'No Tavern asset sources are recorded.',
  'prompt.constant': 'constant entry',
  'prompt.latest': 'Latest request',
  'prompt.request': 'Request',
  'prompt.turn': 'Turn',
  'prompt.step': 'Step',
  'prompt.start': 'Request sequence',
  'prompt.status': 'Status',
  'prompt.statusRunning': 'Running',
  'prompt.statusComplete': 'Complete',
  'prompt.statusError': 'Error',
  'prompt.provider': 'Provider',
  'prompt.model': 'Model',
  'prompt.result': 'Result sequence',
  'prompt.noResult': 'Not recorded',
  'prompt.output': 'Assistant output',
  'prompt.outputRecorded': 'Recorded assistant text',
  'prompt.outputUnavailable': 'The current RequestView provides request status and the result sequence, but not the assistant body. The body remains visible in the conversation flow.',
  'prompt.resultRecorded': 'Recorded result',
  'prompt.usage': 'Usage',
  'prompt.noUsage': 'No usage was recorded for this request.',
  'prompt.error': 'Error',
  'prompt.unknown': 'Unknown',
  'prompt.noPrompt': 'No complete prompt snapshot was recorded for this request.',
  'prompt.gmResponse': 'Parsed GM response',
  'prompt.noGmResponse': 'No retained GM response envelope is available for inspection.',
  'prompt.gmEvent': 'Response event',
  'prompt.assistant': 'Assistant message',
  'prompt.parsedStory': 'Parsed story',
  'prompt.parsedUpdates': 'Parsed fact updates',
  'prompt.noUpdates': 'This response did not include fact updates.',
  'prompt.activation': 'Context activation decisions',
  'prompt.noActivation': 'No context activation record is available for this session.',
  'prompt.included': 'Included',
  'prompt.excluded': 'Excluded',
  'prompt.reason': 'Reason',
  'prompt.matchedKeys': 'Matched keys',
  'prompt.attempted': 'Attempted usage',
  'prompt.accepted': 'Accepted usage',
  'prompt.ledgerUsage': 'Total usage',
  'prompt.characters': 'characters',
  'prompt.tokens': 'tokens',
  'prompt.reasonIncluded': 'Passed filtering',
  'prompt.reasonObserver': 'Observer scope rejected it',
  'prompt.reasonVisibility': 'Visibility rejected it',
  'prompt.reasonAuthority': 'Authority rejected it',
  'prompt.reasonBranch': 'It belongs to another branch',
  'prompt.reasonInvalid': 'The source is invalid',
  'prompt.reasonNotMatched': 'No keywords matched',
  'prompt.reasonGroup': 'Excluded by an activation group',
  'prompt.reasonDuplicate': 'Duplicate source',
  'prompt.reasonBudgetCharacters': 'Character budget exceeded',
  'prompt.reasonBudgetTokens': 'Token budget exceeded',
  'prompt.reasonBudgetBoth': 'Character and token budgets exceeded',
  'library.title': 'Tavern library',
  'library.character': 'Character Card',
  'library.characterSelect': 'Current character',
  'library.worldInfo': 'World Info',
  'library.import': 'Import JSON or PNG',
  'library.noCharacter': 'No Character Card imported.',
  'library.noWorldInfo': 'No World Info imported.',
  'library.none': 'No character',
  'library.entries': 'entries',
  'library.selected': 'Selected',
  'library.localOnly': 'Local draft; Apply selection writes it to the current session.',
  'library.hostManaged': 'Host-managed assets; imported source is kept in the current process.',
  'library.loading': 'Loading Tavern assets...',
  'library.loadFailed': 'Tavern assets could not be loaded. Try again later.',
  'library.operationFailed': 'The Tavern operation failed. Try again later.',
  'library.deleteUnavailable': 'Deleting assets is not available in this environment.',
  'library.invalid': 'Could not import this JSON or PNG file.',
  'library.saving': 'Saving to the current session...',
  'library.saved': 'Selection recorded in the current session.',
  'library.notSelected': 'Select a Character Card or World Info to enable the Tavern prompt path.',
  'library.active': 'Matched entries',
  'swipe.title': 'Swipe candidates',
  'swipe.note': 'Durable assistant alternatives',
  'swipe.empty': 'No assistant candidates have been recorded yet.',
  'swipe.candidates': 'candidates',
  'swipe.emptyCandidate': 'Empty assistant candidate',
  'swipe.previous': 'Previous candidate',
  'swipe.next': 'Next candidate',
  'swipe.regenerate': 'Regenerate',
}
