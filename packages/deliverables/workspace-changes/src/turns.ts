/**
 * The live turns of one Host process, keyed by repository root, so a turn
 * never claims a change another Session's overlapping turn could have made.
 *
 * A snapshot diff says *what* changed in a repository, never *who* changed it.
 * While two Sessions hold turns on one repository at the same time, every
 * change inside either window is ambiguous; a turn whose window overlaps
 * another Session's window therefore falls back to the paths its own file
 * tools captured. Sessions that never overlap — the ordinary single-chat case,
 * and any turn that starts after the other one ended — keep the full snapshot
 * summary.
 * @module
 */

/** One Session's latest turn on one repository. */
interface TurnWindow {
  /** When the turn opened, in milliseconds on the process clock. */
  readonly startedAt: number
  /** When the turn ended, or undefined while it is still open. */
  endedAt?: number
}

/** The turns by repository root, then by owning Session. */
export class RepositoryTurns {
  private readonly roots = new Map<string, Map<object, TurnWindow>>()

  /**
   * Record that a Session opened a turn on one repository. A previous turn of
   * the same Session that never reported its end ends where this one starts.
   * @param root - canonical repository root.
   * @param session - the Session holding the turn, used as an opaque identity.
   * @param startedAt - when the turn opened.
   */
  open(root: string, session: object, startedAt: number): void {
    let turns = this.roots.get(root)
    if (turns === undefined) {
      turns = new Map()
      this.roots.set(root, turns)
    }
    const previous = turns.get(session)
    if (previous !== undefined && previous.endedAt === undefined) previous.endedAt = startedAt
    turns.set(session, { startedAt })
  }

  /**
   * Record that a Session's turn ended. A turn already closed keeps its first
   * end, so a repeated `turn/end` cannot widen the window.
   * @param root - canonical repository root.
   * @param session - the Session whose turn ended.
   * @param endedAt - when the turn ended.
   */
  close(root: string, session: object, endedAt: number): void {
    const window = this.roots.get(root)?.get(session)
    if (window !== undefined && window.endedAt === undefined) window.endedAt = endedAt
  }

  /**
   * Whether a different Session's turn on `root` overlaps `[startedAt, endedAt]`.
   * A turn still open covers the whole ask, since it may write at any moment
   * before the ask ends; a closed turn must reach past the ask's start, so a
   * turn that ends exactly where the next one begins does not count.
   * @param root - canonical repository root.
   * @param session - the Session asking; its own turns are ignored.
   * @param startedAt - the asking turn's start.
   * @param endedAt - the asking turn's end, or now while it is still open.
   * @returns true when another Session held an overlapping turn.
   */
  overlaps(root: string, session: object, startedAt: number, endedAt: number): boolean {
    const turns = this.roots.get(root)
    if (turns === undefined) return false
    for (const [owner, window] of turns) {
      if (owner === session) continue
      if (window.startedAt > endedAt) continue
      if (window.endedAt === undefined || window.endedAt > startedAt) return true
    }
    return false
  }

  /**
   * Forget every window recorded for one Session.
   * @param session - the Session to drop, whatever repository it used.
   */
  forget(session: object): void {
    for (const turns of this.roots.values()) turns.delete(session)
  }
}
