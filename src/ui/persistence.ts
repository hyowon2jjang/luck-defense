import { Rng } from '../core/rng'
import type { GameState } from '../core/types'

/**
 * Saving a run in progress, and the record of runs finished.
 *
 * Both live in `ui/` for the same reason progress does: `core/` may not touch
 * the DOM, and localStorage is the DOM. The simulator therefore never saves,
 * never loads, and cannot be perturbed by anything here.
 *
 * A run is restorable because every random draw goes through a seeded Rng whose
 * state is a single number. That rule was written for replays and the headless
 * simulator; resuming a half-finished run is the same property used a third way.
 */

const RUN_KEY = 'meundee.run'
const STATS_KEY = 'meundee.stats'

/**
 * Bumped whenever the shape of a saved run changes.
 *
 * An old save restored into new code is worse than no save: it loads, looks
 * fine, and then behaves wrongly somewhere subtle. A mismatch is discarded.
 */
const RUN_VERSION = 1

type SavedRng = { seed: number; state: number }

type SavedRun = {
  version: number
  /** Milliseconds, for showing how old a resumed run is. */
  savedAt: number
  seed: number
  state: Omit<GameState, 'rng' | 'projectiles'> & {
    rng: { tier: SavedRng; unitClass: SavedRng; enhance: SavedRng }
  }
}

export type Stats = {
  runs: number
  clears: number
  bestWave: number
  totalKills: number
  totalRolls: number
}

const EMPTY_STATS: Stats = { runs: 0, clears: 0, bestWave: 0, totalKills: 0, totalRolls: 0 }

export function saveRun(state: GameState, seed: number): void {
  // A finished run is not worth resuming into; clearing here means the normal
  // end of a run also cleans up after itself.
  if (state.phase !== 'playing') {
    clearRun()
    return
  }

  // Projectiles are deliberately dropped. There can be hundreds in flight, they
  // live for a fraction of a second, and nobody can tell that the half-dozen
  // mid-air when the tab closed are missing on return.
  const { rng, projectiles: _drop, ...rest } = state
  const payload: SavedRun = {
    version: RUN_VERSION,
    savedAt: Date.now(),
    seed,
    state: {
      ...rest,
      rng: {
        tier: rng.tier.serialize(),
        unitClass: rng.unitClass.serialize(),
        enhance: rng.enhance.serialize(),
      },
    },
  }

  try {
    window.localStorage.setItem(RUN_KEY, JSON.stringify(payload))
  } catch {
    // Private mode, or the quota is full. Losing a save must never break play.
  }
}

/** The run in progress, or null if there is none worth resuming. */
export function loadRun(): { state: GameState; seed: number; savedAt: number } | null {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(RUN_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const saved = JSON.parse(raw) as SavedRun
    if (saved.version !== RUN_VERSION) {
      clearRun()
      return null
    }

    const { rng, ...rest } = saved.state
    const state: GameState = {
      ...rest,
      projectiles: [],
      rng: {
        tier: Rng.deserialize(rng.tier),
        unitClass: Rng.deserialize(rng.unitClass),
        enhance: Rng.deserialize(rng.enhance),
      },
    }

    // A save that predates a field would restore `undefined` into it, which
    // fails later and far from here. One cheap check on the way in.
    if (typeof state.wave !== 'number' || !Array.isArray(state.units)) {
      clearRun()
      return null
    }

    return { state, seed: saved.seed, savedAt: saved.savedAt }
  } catch {
    clearRun()
    return null
  }
}

export function clearRun(): void {
  try {
    window.localStorage.removeItem(RUN_KEY)
  } catch {
    // Nothing to do; an unremovable save is still only a save.
  }
}

export function loadStats(): Stats {
  try {
    const raw = window.localStorage.getItem(STATS_KEY)
    if (!raw) return { ...EMPTY_STATS }
    const parsed = JSON.parse(raw) as Partial<Stats>
    // Merged over the defaults so a stats blob written by older code, missing
    // whatever was added since, still reads.
    return { ...EMPTY_STATS, ...parsed }
  } catch {
    return { ...EMPTY_STATS }
  }
}

/** Folds one finished run into the lifetime record and returns the new totals. */
export function recordRun(state: GameState, rolls: number): Stats {
  const prev = loadStats()
  const next: Stats = {
    runs: prev.runs + 1,
    clears: prev.clears + (state.phase === 'won' ? 1 : 0),
    bestWave: Math.max(prev.bestWave, state.wave),
    totalKills: prev.totalKills + state.kills,
    totalRolls: prev.totalRolls + rolls,
  }
  try {
    window.localStorage.setItem(STATS_KEY, JSON.stringify(next))
  } catch {
    // Unwritable storage means the record lasts this session only.
  }
  return next
}
