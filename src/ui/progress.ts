import { WAVE_COUNT } from '../core/data/waves'
import type { GameState } from '../core/types'

/**
 * What the player has earned across runs, and the only thing that survives one.
 *
 * It lives in `ui/` because `core/` may not touch the DOM — that rule is what
 * lets the headless simulator play thousands of games — and localStorage is the
 * DOM. The simulator therefore never sees unlocks, which is correct: the balance
 * target measures how a run plays, and fast-forwarding does not change a run.
 */

/**
 * Fast-forward multipliers.
 *
 * Speed multiplies how many fixed ticks run per frame, never the tick length,
 * so a run at 3x plays out exactly like the same seed at 1x.
 */
export const SPEEDS = [1, 1.5, 2, 3] as const
export type Speed = (typeof SPEEDS)[number]

/**
 * Waves that must have been cleared, in any past run, before a speed is offered.
 *
 * Fast-forward is the reward for having gone deep once, but a first run at a
 * flat 1x is fifteen minutes of learning the game at its slowest. 1.5x is free
 * for that reason: it takes the edge off the wait without giving away the thing
 * that reaching wave 20 and 25 is supposed to buy.
 */
export const SPEED_UNLOCK: Record<Speed, number> = { 1: 0, 1.5: 0, 2: 20, 3: 25 }

const STORAGE_KEY = 'meundee.bestWave'

/** Waves fully survived. The current wave does not count until it is over. */
export function clearedWaves(state: GameState): number {
  return state.phase === 'won' ? WAVE_COUNT : state.wave - 1
}

export function speedUnlocked(speed: Speed, bestWave: number): boolean {
  return bestWave >= SPEED_UNLOCK[speed]
}

/** The best cleared wave on record, or 0 if nothing is stored or readable. */
export function loadBestWave(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value = Number(raw)
    // A hand-edited or corrupted entry should cost the unlock, not the run.
    return Number.isFinite(value) ? Math.min(Math.max(0, Math.floor(value)), WAVE_COUNT) : 0
  } catch {
    // Private browsing and blocked site data both throw here. Progress is a
    // convenience; losing it must never stop the game loading.
    return 0
  }
}

/** Records `wave` if it beats the stored best. Returns what is now on record. */
export function saveBestWave(wave: number): number {
  const best = Math.max(loadBestWave(), Math.floor(wave))
  try {
    window.localStorage.setItem(STORAGE_KEY, String(best))
  } catch {
    // Unwritable storage means the unlock lasts this session only.
  }
  return best
}
