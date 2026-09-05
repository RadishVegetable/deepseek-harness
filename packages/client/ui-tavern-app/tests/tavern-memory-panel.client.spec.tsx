// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { TavernMemoryInspection } from '@deepseek-ai/dsh-tavern-host/client'
import { en, type TavernAppKey } from '../src/client/locales.ts'
import { TavernJourney } from '../src/client/TavernJourney.tsx'
import { TavernMemoryPanel } from '../src/client/TavernMemoryPanel.tsx'

afterEach(() => { cleanup() })

const t = ((key: TavernAppKey, params?: Record<string, unknown>): string => {
  let value = en[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as Parameters<typeof TavernMemoryPanel>[0]['t']

const projection = {
  character: { id: 'card-1', kind: 'character', name: 'Aster', description: 'Careful archivist.', personality: 'Guarded but kind.', scenario: 'The archive is waiting.', firstMessage: '', creatorNotes: '', messageExamples: '', alternateGreetings: [], systemPrompt: '', postHistoryInstructions: '', characterBook: { id: 'card-1.character-book', kind: 'world-info', name: 'Aster attached book', entries: [{ id: 'entry-npc', content: 'Name: Medie\nType: character\nRole: secretary' }] } },
  characterFields: [{ id: 'character-description', label: 'Description', value: 'Careful archivist.', origin: 'asset' }, { id: 'temperament', label: 'Temperament', value: 'Guarded but kind.', origin: 'fact', factId: 'fact-new' }],
  people: [{ personId: 'person:medie', name: 'Medie', source: { assetId: 'card-1.character-book', entryId: 'entry-npc' }, content: 'Name: Medie\nType: character\nRole: secretary', fields: [], facts: [] }, { personId: 'person:medie', name: 'Medie', source: { assetId: 'world-1', entryId: 'entry-npc-duplicate' }, content: 'Name: Medie\nType: character\nRole: secretary', fields: [], facts: [] }],
  worldInfo: [{ id: 'world-1', kind: 'world-info', name: 'Standalone World', entries: [{ id: 'entry-world', content: 'Geography: Lower archive.' }] }],
  worldFields: [{ id: 'world-field', label: 'Geography', value: 'Lower archive.', origin: 'fact', factId: 'world-fact' }],
  facts: {
    people: { 'person:aster': [{ factId: 'fact-new', target: 'person', personId: 'person:aster', text: 'Guarded but kind.', label: 'Temperament', branch: 'main', authority: 'gm', kind: 'soft', source: { kind: 'assistant', assistantSeq: 3 }, eventSeq: 4, turn: 2 }] },
    world: [{ factId: 'world-fact', target: 'world', text: 'The archive seals at dusk.', label: 'Rule', branch: 'main', authority: 'observed', kind: 'soft', source: { kind: 'asset', assetId: 'world-1', entryId: 'entry-world' }, eventSeq: 3 }],
    conflicts: [{ id: 'conflict-1', factId: 'fact-new', previousFactId: 'fact-old', label: 'Temperament', previousText: 'Open and warm.', incomingText: 'Guarded but kind.', previousAuthority: 'user', incomingAuthority: 'gm', previousEventSeq: 2, incomingEventSeq: 4 }],
  },
} as unknown as NonNullable<Parameters<typeof TavernMemoryPanel>[0]['projection']>

const facts = { projection: projection.facts, records: [] } as unknown as Parameters<typeof TavernMemoryPanel>[0]['facts']
const memoryInspection = { checkpoints: [{ compactionId: CompactionId('checkpoint-1'), summarySeq: 12, checkpointSeq: 13, plotSummary: 'The party reached the archive.', openThreads: ['Who hid the key?'], shadowedTurns: { start: 1, end: 1 } }] } satisfies TavernMemoryInspection

function renderPanel(overrides: Partial<Parameters<typeof TavernMemoryPanel>[0]> = {}): void {
  render(<TavernMemoryPanel projection={projection} facts={facts} onClose={vi.fn()} t={t} {...overrides} />)
}

describe('Tavern context drawer', () => {
  it('shows one expandable entry per character and merges repeated person ids', () => {
    renderPanel()
    expect(screen.getByRole('tab', { name: 'Characters' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('group')).toHaveLength(2)
    expect(screen.getAllByText('Medie')).toHaveLength(1)
    fireEvent.click(screen.getByText('Aster'))
    expect(screen.getAllByText('Careful archivist.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Guarded but kind.').length).toBeGreaterThan(0)
  })

  it('shows world information while excluding NPC entries from World', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'World' }))
    expect(screen.getByText('World information and overview')).toBeTruthy()
    expect(screen.getByText('Standalone World')).toBeTruthy()
    expect(screen.queryByText('Aster attached book')).toBeNull()
    expect(screen.queryByText(text => text.includes('Name: Medie'))).toBeNull()
    expect(screen.getByText('Geography: Lower archive.')).toBeTruthy()
  })

  it('does not show a standalone copy of an embedded World Book twice', () => {
    const duplicateProjection = {
      ...projection,
      worldInfo: [{ id: 'world-copy', kind: 'world-info', name: 'Standalone Copy', entries: [{ id: 'entry-copy', content: 'Name: Medie\nType: character\nRole: secretary' }] }],
    } as unknown as typeof projection
    renderPanel({ projection: duplicateProjection })
    fireEvent.click(screen.getByRole('tab', { name: 'World' }))
    expect(screen.queryByText('Aster attached book')).toBeNull()
    expect(screen.queryByText('Standalone Copy')).toBeNull()
    expect(screen.queryByText(text => text.includes('Name: Medie'))).toBeNull()
  })

  it('keeps character-shaped world entries out of the world view', () => {
    const mixedProjection = {
      ...projection,
      worldInfo: [{ id: 'world-mixed', kind: 'world-info', name: 'Mixed World', entries: [
        { id: 'entry-character', content: 'Name: Jessie\nAppearance: Tanned and freckled.\nPersonality: Cheerful and hardworking.' },
        { id: 'entry-region', content: 'Geography: The northern coast.' },
      ] }],
    } as unknown as typeof projection
    renderPanel({ projection: mixedProjection })
    fireEvent.click(screen.getByRole('tab', { name: 'World' }))
    expect(screen.queryByText(text => text.includes('Tanned and freckled'))).toBeNull()
    expect(screen.getByText('Geography: The northern coast.')).toBeTruthy()
  })

  it('keeps memory entries and checkpoints together without story state or cleaning views', () => {
    renderPanel({ memoryInspection })
    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }))
    expect(screen.getByText('Memory-system entries')).toBeTruthy()
    expect(screen.getByText('The archive seals at dusk.')).toBeTruthy()
    expect(screen.getByText('The party reached the archive.')).toBeTruthy()
    expect(screen.queryByText('People / World')).toBeNull()
    expect(screen.queryByText('Fact event stream')).toBeNull()
    expect(screen.queryByText('Story State')).toBeNull()
  })

  it('requires impact confirmation before editing and removing memory entries', async () => {
    const sessionId = 'memory-session' as SessionId
    const editFact = vi.fn(async () => ({ ok: true as const, value: facts }))
    const removeFact = vi.fn(async () => ({ ok: true as const, value: facts }))
    const tavernAssets = { editFact, removeFact, resolveConflict: vi.fn(async () => ({ ok: true as const, value: facts })) } as unknown as NonNullable<Parameters<typeof TavernMemoryPanel>[0]['tavernAssets']>
    renderPanel({ sessionId, tavernAssets })
    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit memory' })[0]!)
    fireEvent.change(screen.getByLabelText('Memory content'), { target: { value: 'Revised memory.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review impact' }))
    expect(await screen.findByRole('dialog', { name: 'Confirm this impact?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and execute' }))
    await waitFor(() => { expect(editFact).toHaveBeenCalledWith(sessionId, { factId: 'fact-new', text: 'Revised memory.' }) })
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete memory' })[0]!)
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm memory deletion' }))
    await waitFor(() => { expect(removeFact).toHaveBeenCalledWith(sessionId, { factId: 'fact-new' }) })
  })

  it('opens the unified context drawer and loads facts and memory from the Host', async () => {
    const sessionId = 'journey-memory' as SessionId
    const snapshot = { sessionId, nodes: [], partial: null, running: false, removed: false, openState: 'open', openError: null, lastAgentError: null, promptError: null } as unknown as ConversationSnapshot
    const inspectFacts = vi.fn(async () => ({ ok: true as const, value: facts }))
    const inspectMemory = vi.fn(async () => ({ ok: true as const, value: memoryInspection }))
    const props = {
      sessionId,
      useSession: <T,>(selector: (value: ConversationSnapshot) => T): T => selector(snapshot),
      route: 'journey',
      onNavigateToLibrary: vi.fn(),
      tavernAssets: {
        inspectJourneyAssets: async () => ({ ok: true as const, value: projection }),
        inspectFacts,
        inspectMemory,
        inspectSwipe: async () => ({ ok: true as const, value: { groups: [] } }),
      },
      sessions: { binding: () => ({ sessionId, session: { prompt: vi.fn(), cancel: vi.fn() } }) },
      t,
    } as unknown as Parameters<typeof TavernJourney>[0]
    render(<TavernJourney {...props} />)
    const trigger = await screen.findByRole('button', { name: 'Characters / World / Memory' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Journey context' })
    expect(dialog.getAttribute('id')).toBe('tavern-context-drawer')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-controls')).toBe('tavern-context-drawer')
    expect(screen.getByRole('tab', { name: 'Characters' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'World' }))
    expect(screen.getByRole('tab', { name: 'Characters' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: 'World' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }))
    expect(screen.getByRole('tab', { name: 'World' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: 'Memory' }).getAttribute('aria-selected')).toBe('true')
    await waitFor(() => { expect(inspectFacts).toHaveBeenCalledWith(sessionId); expect(inspectMemory).toHaveBeenCalledWith(sessionId) })
    expect(screen.queryByRole('button', { name: 'Assets' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Facts' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Story State' })).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Journey context' })).toBeNull() })
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Journey context' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Journey context' }))
    expect(screen.queryByRole('dialog', { name: 'Journey context' })).toBeNull()
    fireEvent.click(trigger)
    expect(await screen.findByRole('dialog', { name: 'Journey context' })).toBeTruthy()
    fireEvent.click(screen.getByRole('presentation', { hidden: true }))
    expect(screen.queryByRole('dialog', { name: 'Journey context' })).toBeNull()
  })
})
