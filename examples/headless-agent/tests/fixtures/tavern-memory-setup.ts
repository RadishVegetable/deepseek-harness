/** Loader fixture that bootstraps a real Tavern Journey and two prior turns. */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'

export const name = 'tavern-memory-setup'
export const inject = ['agents', 'agentLoop', 'jobs', 'tavernAssets']

async function rootAgent(ctx: Context): Promise<Agent> {
  const current = ctx.agents.roots()[0]
  if (current !== undefined) return current
  return new Promise<Agent>((resolve) => {
    const dispose = ctx.on('agent/created', ({ agent }) => {
      if (!ctx.agents.roots().includes(agent)) return
      dispose()
      resolve(agent)
    })
  })
}

function waitForExtraction(ctx: Context, agent: Agent): Promise<void> {
  return new Promise<void>((resolve) => {
    const dispose = ctx.jobs.onJobDone((job, owner) => {
      if (owner !== agent || job.kind !== 'memory-extraction') return
      dispose()
      resolve()
    })
  })
}

async function runTurn(ctx: Context, agent: Agent, text: string): Promise<void> {
  const extraction = waitForExtraction(ctx, agent)
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
  await extraction
}

async function compactHistory(ctx: Context, agent: Agent): Promise<void> {
  const compaction = ctx.get('compaction')
  if (compaction === undefined) throw new Error('Tavern memory snapshot did not mount compaction')
  const assistant = agent.session.events.find(event => event.type === 'assistant/message')
  if (assistant === undefined) throw new Error('Tavern memory snapshot did not produce a history response')
  await compaction.compactRegion(assistant.seq, assistant.seq, agent)
}

/** Import one source card, select it for the live Session, and create history. */
export async function apply(ctx: Context): Promise<void> {
  ctx.jobs.attachController('tavern-memory-snapshot')
  if (ctx.get('compaction') === undefined) throw new Error('Tavern memory snapshot did not mount compaction')
  const agent = await rootAgent(ctx)
  const character = await ctx.tavernAssets.remoteImportCharacter(JSON.stringify({
    spec: 'chara_card_v2',
    data: {
      name: 'Archivist',
      description: 'A careful archivist in a midnight archive.',
      first_mes: '',
    },
  }), { id: 'tavern-memory-snapshot-card' })
  await ctx.tavernAssets.remoteSelectForSession(
    agent,
    { characterId: character.id, worldInfoIds: [] },
    'the archive player',
  )
  await runTurn(ctx, agent, 'TAVERN_PRELUDE_DOOR: open the archive door.')
  await runTurn(ctx, agent, 'TAVERN_PRELUDE_HALL: cross the archive hall.')
  await compactHistory(ctx, agent)
}
