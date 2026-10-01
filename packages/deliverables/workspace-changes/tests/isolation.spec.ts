/**
 * A turn shares its repository with every other Session of the same working
 * directory, so it claims only what it can attribute to itself: while another
 * Session's turn overlaps, the snapshot diff is dropped and the summary lists
 * this Session's file-tool edits alone.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as WorkspaceChanges from '../src/index.ts'
import { changes, endTurn, git, mutate, scratchDir, settle, startTurn, toolCall } from './support.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function boot(): Promise<Context> {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(WorkspaceChanges, {} as WorkspaceChanges.Config)
  return ctx
}

async function repository(): Promise<string> {
  const cwd = await scratchDir('dsh-workspace-changes-isolation-', cleanups)
  git(cwd, 'init', '-q', '-b', 'main')
  await writeFile(join(cwd, 'a.txt'), 'l1\n')
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', 'init')
  return cwd
}

/** One Session of the same repository, its turn already open. */
async function opened(ctx: Context, id: string, cwd: string, turn: number): Promise<Session> {
  const session = ctx.sessions.create(SessionId(id), { meta: { cwd } })
  startTurn(session, turn)
  await settle(ctx, session)
  return session
}

describe('two Sessions in one repository', () => {
  it('lists only its own file-tool edits while another Session’s turn overlaps', async () => {
    const cwd = await repository()
    const ctx = await boot()
    const mine = await opened(ctx, 'mine', cwd, 1)
    // The other Session holds its turn across the whole of ours.
    await opened(ctx, 'other', cwd, 1)
    // A change no file tool of this Session made — the other Session's shell, an
    // editor, a build. The snapshot sees it; this Session must not claim it.
    await writeFile(join(cwd, 'foreign.txt'), 'other session\n')
    // Its own edit is still listed, from the capture taken before the tool ran.
    await mutate(ctx, mine, 1, 'edit', { file_path: 'a.txt', old_string: 'l1', new_string: 'l1 mine' },
      () => writeFile(join(cwd, 'a.txt'), 'l1 mine\n'))
    endTurn(mine, 1)
    await settle(ctx, mine)

    const [recorded, ...rest] = changes(ctx, mine)
    expect(rest).toEqual([])
    expect(recorded).toMatchObject({ turn: 1, cwd, total: 1, added: 1, deleted: 1 })
    expect(recorded!.files.map(file => file.path)).toEqual(['a.txt'])
    // No snapshot was taken, so no comparison can be served from one.
    expect(recorded!.snapshot).toBeUndefined()
  })

  it('claims the snapshot summary again once the other Session’s turn is over', async () => {
    const cwd = await repository()
    const ctx = await boot()
    const other = await opened(ctx, 'other', cwd, 1)
    endTurn(other, 1)
    await settle(ctx, other)
    const mine = await opened(ctx, 'mine', cwd, 1)
    // With no turn in flight beside ours, the snapshot covers writes no file tool made.
    await writeFile(join(cwd, 'shell.txt'), 'from a shell\n')
    toolCall(mine, 1, 'bash', { command: 'printf > shell.txt' })
    endTurn(mine, 1)
    await settle(ctx, mine)

    const recorded = changes(ctx, mine).at(-1)
    expect(recorded).toMatchObject({ turn: 1, total: 1 })
    expect(recorded!.files.map(file => file.path)).toEqual(['shell.txt'])
    expect(recorded!.snapshot!.before).toMatch(/^[0-9a-f]{40,64}$/)
  })

  it('keeps the snapshot summary when only this Session holds a turn', async () => {
    const cwd = await repository()
    const ctx = await boot()
    const mine = await opened(ctx, 'alone', cwd, 1)
    await writeFile(join(cwd, 'external.txt'), 'external\n')
    toolCall(mine, 1, 'bash', { command: 'true' })
    endTurn(mine, 1)
    await settle(ctx, mine)

    const recorded = changes(ctx, mine).at(-1)
    expect(recorded!.files.map(file => file.path)).toEqual(['external.txt'])
  })

  it('ignores a turn/end naming a turn this Session never opened', async () => {
    const cwd = await repository()
    const ctx = await boot()
    const alone = await opened(ctx, 'alone', cwd, 1)
    // Only the snapshot can list a change no file tool made.
    await writeFile(join(cwd, 'external.txt'), 'external\n')
    toolCall(alone, 1, 'bash', { command: 'true' })
    // A turn/end for another turn neither closes the window nor records.
    endTurn(alone, 2)
    await settle(ctx, alone)
    expect(changes(ctx, alone)).toEqual([])

    endTurn(alone, 1)
    await settle(ctx, alone)
    expect(changes(ctx, alone).at(-1)!.files.map(file => file.path)).toEqual(['external.txt'])
  })
})
