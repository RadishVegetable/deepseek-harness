/** `tavern` namespace dictionaries for the roleplay workbench. */

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
  | 'shell.newSession'
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
  | 'prompt.provider'
  | 'prompt.model'
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
  | 'conversation.title'
  | 'editor.title'
  | 'editor.export'
  | 'editor.exported'
  | 'editor.save'
  | 'editor.saved'
  | 'editor.invalid'
  | 'editor.sourceJson'
  | 'editor.worldSelect'
  | 'editor.noCharacter'
  | 'editor.noWorldInfo'
  | 'editor.noAssets'
  | 'memory.title'
  | 'memory.loading'
  | 'memory.text'
  | 'memory.level'
  | 'memory.label'
  | 'memory.add'
  | 'memory.update'
  | 'memory.edit'
  | 'memory.empty'
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
    /** The Tavern workbench copy. */
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
  'workspace.title': 'Tavern 角色扮演工作台',
  'workspace.character': '当前角色',
  'workspace.noCharacter': '选择一张角色卡，开始角色扮演会话。',
  'workspace.greeting': '开场白',
  'workspace.greetingHint': '这是角色卡中的开场内容；下一条消息会通过持久化会话发送。',
  'workspace.recent': '角色扮演',
  'workspace.noMessages': '还没有角色扮演消息。',
  'workspace.transcript': '持久化会话记录',
  'workspace.world': '当前会话的 World Info',
  'workspace.worldNone': '未选择 World Info。',
  'workspace.mode': '交互模式',
  'workspace.direct': '直接对话 - 单个角色',
  'conversation.title': '角色扮演对话',
  'editor.title': '资源编辑与导出',
  'editor.export': '导出 JSON',
  'editor.exported': '已开始下载 JSON。',
  'editor.save': '保存资源',
  'editor.saved': '资源已保存。',
  'editor.invalid': '资源 JSON 无效或保存失败。',
  'editor.sourceJson': '源 JSON',
  'editor.worldSelect': '选择 World Info',
  'editor.noCharacter': '当前没有选择角色卡。',
  'editor.noWorldInfo': '当前没有 World Info。',
  'editor.noAssets': '还没有可编辑的 Tavern 资源。',
  'memory.title': 'Memory',
  'memory.loading': '正在加载记忆...',
  'memory.text': '记忆内容',
  'memory.level': '层级',
  'memory.label': '标签',
  'memory.add': '添加记忆',
  'memory.update': '更新记忆',
  'memory.edit': '编辑',
  'memory.empty': '当前会话还没有记忆。',
  'story.title': 'Story State',
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
  'swipe.note': '持久化的 assistant 候选',
  'swipe.empty': '当前还没有记录 assistant 候选。',
  'swipe.candidates': '个候选',
  'swipe.emptyCandidate': '空 assistant 候选',
  'swipe.previous': '上一个候选',
  'swipe.next': '下一个候选',
  'swipe.regenerate': '重新生成',
  'view.tavern': 'Tavern',
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
  'shell.noSession': '暂无 Tavern 会话',
  'shell.newSession': '新建会话',
  'shell.retry': '重试',
  'drawer.close': '关闭面板',
  'selection.unsaved': '有未保存选择',
  'selection.saved': '选择已保存',
  'selection.reset': '重置',
  'selection.apply': '应用选择',
  'context.title': '上下文',
  'context.assets': '当前资源',
  'context.noCharacter': '未选择角色卡。',
  'context.noWorldInfo': '未选择 World Info。',
  'context.baselineEntries': 'Baseline 条目',
  'context.runtime': '运行状态',
  'context.lastRequest': '最近请求',
  'context.noRequest': '尚未记录模型请求。',
  'prompt.title': '提示词检查',
  'prompt.empty': '当前会话还没有已记录的模型请求。',
  'prompt.openTrajectory': '在 Trajectory 中查看完整请求',
  'prompt.system': 'System prompt',
  'prompt.tools': '工具',
  'prompt.noTools': '这次请求没有记录工具。',
  'prompt.worldInfo': 'World Info',
  'prompt.noWorldInfo': '当前选择中没有可用的 World Info 条目。',
  'prompt.sources': '来源',
  'prompt.noSources': '没有记录 Tavern 资源来源。',
  'prompt.constant': '常量条目',
  'prompt.latest': '最近一次请求',
  'prompt.request': '请求',
  'prompt.provider': 'Provider',
  'prompt.model': 'Model',
  'library.title': 'Tavern 资源库',
  'library.character': '角色卡',
  'library.characterSelect': '当前角色',
  'library.worldInfo': 'World Info',
  'library.import': '导入 JSON 或 PNG',
  'library.noCharacter': '还没有导入角色卡。',
  'library.noWorldInfo': '还没有导入 World Info。',
  'library.none': '不选择角色',
  'library.entries': '条目',
  'library.selected': '已选择',
  'library.localOnly': '本地草稿；点击“应用选择”后写入当前会话。',
  'library.hostManaged': '资源由 Host 管理；导入源会保存在当前进程中。',
  'library.loading': '正在加载 Tavern 资源...',
  'library.loadFailed': 'Tavern 资源暂时无法加载，请稍后重试。',
  'library.operationFailed': 'Tavern 操作失败，请稍后重试。',
  'library.invalid': '无法导入这个 JSON 或 PNG 文件。',
  'library.saving': '正在保存到当前会话...',
  'library.saved': '选择已记录到当前会话。',
  'library.notSelected': '选择角色卡或 World Info 以启用 Tavern 提示词链路。',
  'library.active': '已匹配条目',
}

/** English dictionary. */
export const en: Record<TavernKey, string> = {
  'message.edit': 'Edit message',
  'message.editInput': 'Message text',
  'message.editSave': 'Save edit',
  'message.editCancel': 'Cancel edit',
  'message.editFailed': 'Edit failed',
  'workspace.title': 'Tavern roleplay workspace',
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
  'workspace.direct': 'Direct - one character',
  'conversation.title': 'Roleplay conversation',
  'editor.title': 'Asset editor and export',
  'editor.export': 'Export JSON',
  'editor.exported': 'JSON download started.',
  'editor.save': 'Save asset',
  'editor.saved': 'Asset saved.',
  'editor.invalid': 'The asset JSON is invalid or could not be saved.',
  'editor.sourceJson': 'Source JSON',
  'editor.worldSelect': 'Select World Info',
  'editor.noCharacter': 'No Character Card is selected.',
  'editor.noWorldInfo': 'No World Info is available.',
  'editor.noAssets': 'No Tavern assets are available to edit.',
  'memory.title': 'Memory',
  'memory.loading': 'Loading memories...',
  'memory.text': 'Memory text',
  'memory.level': 'Level',
  'memory.label': 'Label',
  'memory.add': 'Add memory',
  'memory.update': 'Update memory',
  'memory.edit': 'Edit',
  'memory.empty': 'No memories in this session.',
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
  'shell.newSession': 'New session',
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
  'prompt.provider': 'Provider',
  'prompt.model': 'Model',
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
