/**
 * How long each wave is actually a fight, using the same heuristic policy the
 * clear-rate numbers come from.
 *
 * A wave can span thirty seconds and still feel like nothing happened: monsters
 * trickle in over the spawn window, and if each one dies the instant it enters
 * range, the track is empty almost always and there is no fight to watch. The
 * clear rate cannot see this — the run is going fine, it is just boring.
 *
 * So this measures what a player actually experiences:
 *
 *   fight     first spawn of the wave to the last death of its monsters
 *   peak      most of that wave's monsters alive at once
 *   mean      average alive while the wave was in progress
 *   carried   the wave was not finished before the next one arrived
 *
 * A peak of 1 means monsters are popping as they appear.
 *
 *   npm run waves [runs]
 */
import { createGame, dispatch, tick } from '../core/game'
import { WAVES, WAVE_COUNT } from '../core/data/waves'
import { Rng } from '../core/rng'
import { heuristicPolicy } from './policies'

const FIXED_DT = 1 / 60
const MAX_SIM_SECONDS = 60 * 60
const DECISION_INTERVAL = 0.5

type WaveStat = {
  firstSeen: number
  lastSeen: number
  peak: number
  sum: number
  samples: number
  carried: boolean
}

function watch(seed: number): Map<number, WaveStat> {
  const state = createGame(seed)
  const policyRng = new Rng(seed ^ 0x9e3779b9)
  const stats = new Map<number, WaveStat>()

  let seconds = 0
  let nextDecision = 0

  while (state.phase === 'playing' && seconds < MAX_SIM_SECONDS) {
    if (seconds >= nextDecision) {
      nextDecision = seconds + DECISION_INTERVAL
      for (const cmd of heuristicPolicy.decide(state, policyRng)) dispatch(state, cmd)
    }

    tick(state, FIXED_DT)
    seconds += FIXED_DT

    // Monsters remember the wave that sent them, which is what makes this
    // measurable at all once waves start overlapping.
    const alive = new Map<number, number>()
    for (const m of state.monsters) {
      if (m.hp <= 0) continue
      alive.set(m.spawnedOnWave, (alive.get(m.spawnedOnWave) ?? 0) + 1)
    }

    for (const [wave, count] of alive) {
      let stat = stats.get(wave)
      if (!stat) {
        stat = {
          firstSeen: seconds,
          lastSeen: seconds,
          peak: 0,
          sum: 0,
          samples: 0,
          carried: false,
        }
        stats.set(wave, stat)
      }
      stat.lastSeen = seconds
      stat.peak = Math.max(stat.peak, count)
      stat.sum += count
      stat.samples++
      // Still alive after its own wave ended: the player never caught up.
      if (state.wave > wave) stat.carried = true
    }
  }

  return stats
}

const runs = Number(process.argv[2] ?? 10)
const collected = new Map<number, WaveStat[]>()

for (let i = 0; i < runs; i++) {
  for (const [wave, stat] of watch(1000 + i)) {
    const list = collected.get(wave) ?? []
    list.push(stat)
    collected.set(wave, list)
  }
}

console.log(`heuristic policy, ${runs} runs`)
console.log()
console.log('wave  spawns   fight   peak   mean   carried')

for (let wave = 1; wave <= WAVE_COUNT; wave++) {
  const list = collected.get(wave)
  if (!list || list.length === 0) continue

  const mean = (pick: (s: WaveStat) => number) =>
    list.reduce((n, s) => n + pick(s), 0) / list.length

  const fight = mean((s) => s.lastSeen - s.firstSeen)
  const peak = mean((s) => s.peak)
  const avg = mean((s) => (s.samples > 0 ? s.sum / s.samples : 0))
  const carried = list.filter((s) => s.carried).length

  const def = WAVES[wave - 1]
  const flag = def.boss ? ' boss' : ''

  console.log(
    `${String(wave).padStart(4)}  ${String(def.count).padStart(6)}  ` +
      `${`${fight.toFixed(1)}s`.padStart(6)}  ${peak.toFixed(1).padStart(5)}  ` +
      `${avg.toFixed(1).padStart(5)}  ${`${((carried / list.length) * 100).toFixed(0)}%`.padStart(7)}` +
      flag,
  )
}
