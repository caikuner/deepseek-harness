/**
 * The live-turn registry decides which turns are ambiguous. A snapshot diff
 * cannot say which Session wrote a change, so these windows are what stops two
 * Sessions of one repository from claiming each other's work: a live window
 * covers the whole ask, a closed one must reach past the ask's start, and a
 * Session's own windows never count against it.
 */
import { describe, expect, it } from 'vitest'
import { RepositoryTurns } from '../src/turns.ts'

const ROOT = '/repo'
const OTHER_ROOT = '/other'
const mine = {}
const other = {}

describe('RepositoryTurns', () => {
  it('sees no overlap in a repository no turn ever opened', () => {
    expect(new RepositoryTurns().overlaps(ROOT, mine, 0, 100)).toBe(false)
  })

  it('counts a live window of another Session over the whole ask, and never its own', () => {
    const turns = new RepositoryTurns()
    turns.open(ROOT, other, 50)
    expect(turns.overlaps(ROOT, mine, 0, 100)).toBe(true)
    expect(turns.overlaps(ROOT, other, 0, 100)).toBe(false)
  })

  it('ignores a window that opens after the ask ends', () => {
    const turns = new RepositoryTurns()
    turns.open(ROOT, other, 101)
    expect(turns.overlaps(ROOT, mine, 0, 100)).toBe(false)
  })

  it('counts a closed window that reaches past the ask’s start', () => {
    const turns = new RepositoryTurns()
    turns.open(ROOT, other, 50)
    turns.close(ROOT, other, 80)
    expect(turns.overlaps(ROOT, mine, 0, 100)).toBe(true)
  })

  it('does not count a window ending exactly where the ask starts', () => {
    const turns = new RepositoryTurns()
    turns.open(ROOT, other, 10)
    turns.close(ROOT, other, 50)
    expect(turns.overlaps(ROOT, mine, 50, 100)).toBe(false)
  })

  it('keeps the first end when one turn closes twice', () => {
    const turns = new RepositoryTurns()
    turns.open(ROOT, other, 10)
    turns.close(ROOT, other, 50)
    turns.close(ROOT, other, 90)
    expect(turns.overlaps(ROOT, mine, 60, 100)).toBe(false)
  })

  it('replaces the window of a Session whose next turn opens without an end', () => {
    const turns = new RepositoryTurns()
    turns.open(ROOT, other, 10)
    turns.open(ROOT, other, 70)
    expect(turns.overlaps(ROOT, mine, 0, 50)).toBe(false)
    expect(turns.overlaps(ROOT, mine, 0, 100)).toBe(true)
  })

  it('takes a close for a repository or Session it never recorded', () => {
    const turns = new RepositoryTurns()
    turns.close(ROOT, mine, 50)
    turns.open(OTHER_ROOT, other, 0)
    turns.close(OTHER_ROOT, mine, 50)
    expect(turns.overlaps(OTHER_ROOT, mine, 0, 100)).toBe(true)
  })

  it('forgets a Session in every repository it used', () => {
    const turns = new RepositoryTurns()
    turns.open(ROOT, other, 0)
    turns.open(OTHER_ROOT, other, 0)
    turns.forget(other)
    expect(turns.overlaps(ROOT, mine, 0, 100)).toBe(false)
    expect(turns.overlaps(OTHER_ROOT, mine, 0, 100)).toBe(false)
  })
})
