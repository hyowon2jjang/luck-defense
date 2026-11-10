/**
 * Watches what actually happens to each boss, using the same heuristic policy
 * the clear-rate numbers come from.
 *
 * A clear rate cannot tell a working trait from a dead one: a Revenant whose
 * healing never fires and a Revenant with 15x health both just read as "the
 * run ended at wave 25". This prints the trait itself — seconds to kill, health
 * healed back, seconds spent shielded, monsters left behind — so a broken trait
 * shows up as a zero instead of hiding inside the balance target.
 *
 *   npm run bosses [runs]
 */
import { createGame, dispatch, tick } from '../core/game'
import { BOSSES, BOSS_BY_KEY } from '../core/data/bosses'
import { Rng } from '../core/rng'
import { heuristicPolicy } from './policies'
import type { BossKey, GameState } from '../core/types'

const FIXED_DT = 1 / 60
const MAX_SIM_SECONDS = 60 * 60
const DECISION_INTERVAL = 0.5

type Fight = {
  key: BossKey
  spawnedAt: number
  killedAt: number | null
  /** Health regained, as a multiple of its max — the Revenant's whole trait. */
  healed: number
  /** Seconds its damage reduction was actually up. */
  shielded: number
  /** Monsters it left behind on death. */
  brood: number
  /** Distinct size classes it was seen in — proves the rotation ran. */
  sizes: Set<string>
}

function watch(seed: number): Fight[] {
  const state = createGame(seed)
  const policyRng = new Rng(seed ^ 0x9e3779b9)
  const fights = new Map<number, Fight>()

  let seconds = 0
  let nextDecision = 0

  while (state.phase === 'playing' && seconds < MAX_SIM_SECONDS) {
    if (seconds >= nextDecision) {
      nextDecision = seconds + DECISION_INTERVAL
      for (const cmd of heuristicPolicy.decide(state, policyRng)) dispatch(state, cmd)
    }

    const hpBefore = new Map<number, number>()
    for (const m of state.monsters) if (m.boss !== null) hpBefore.set(m.id, m.hp)
    const countBefore = state.monsters.length

    tick(state, FIXED_DT)
    seconds += FIXED_DT

    let bossesAfter = 0
    for (const m of state.monsters) {
      if (m.boss === null) continue
      bossesAfter++

      let fight = fights.get(m.id)
      if (!fight) {
        fight = {
          key: m.boss,
          spawnedAt: seconds,
          killedAt: null,
          healed: 0,
          shielded: 0,
          brood: 0,
          sizes: new Set<string>(),
        }
        fights.set(m.id, fight)
      }

      const before = hpBefore.get(m.id)
      if (before !== undefined && m.hp > before) fight.healed += (m.hp - before) / m.maxHp

      const def = BOSS_BY_KEY[m.boss]
      if (def.escortedTaken < 1 && countLive(state) > 1) fight.shielded += FIXED_DT
      if (def.cycle) fight.sizes.add(m.size)
    }

    // Anything the tick removed was killed. Its brood is whatever the monster
    // count gained on the same tick that the corpse left it.
    const died = hpBefore.size - bossesAfter
    if (died > 0) {
      for (const [id, fight] of fights) {
        if (fight.killedAt !== null || state.monsters.some((m) => m.id === id)) continue
        fight.killedAt = seconds
        fight.brood = Math.max(0, state.monsters.length - (countBefore - 1))
      }
    }
  }

  return [...fights.values()]
}

function countLive(state: GameState): number {
  let n = 0
  for (const m of state.monsters) if (m.hp > 0) n++
  return n
}

const runs = Number(process.argv[2] ?? 8)
const fights: Fight[] = []
for (let i = 0; i < runs; i++) fights.push(...watch(1000 + i))

console.log(`heuristic policy, ${runs} runs`)
console.log()
console.log('boss          met  killed   kill time   healed   shielded   brood  sizes   trait')

for (const def of BOSSES) {
  const all = fights.filter((f) => f.key === def.key)
  if (all.length === 0) {
    console.log(`${def.name.padEnd(13)} ${'0'.padStart(3)}   never reached`)
    continue
  }

  const killed = all.filter((f) => f.killedAt !== null)
  const killTime = killed.length
    ? `${(killed.reduce((n, f) => n + (f.killedAt! - f.spawnedAt), 0) / killed.length).toFixed(1)}s`
    : '—'
  const mean = (pick: (f: Fight) => number) =>
    all.reduce((n, f) => n + pick(f), 0) / all.length

  console.log(
    `${def.name.padEnd(13)} ${String(all.length).padStart(3)}  ${String(killed.length).padStart(6)}  ` +
      `${killTime.padStart(10)}   ${`${(mean((f) => f.healed) * 100).toFixed(0)}%`.padStart(6)}   ` +
      `${`${mean((f) => f.shielded).toFixed(1)}s`.padStart(8)}   ` +
      `${mean((f) => f.brood).toFixed(1).padStart(5)}  ` +
      `${String(mean((f) => f.sizes.size).toFixed(1)).padStart(5)}   ${trait(def.key)}`,
  )
}

/** One word for what the row is supposed to prove. */
function trait(key: BossKey): string {
  const def = BOSS_BY_KEY[key]
  if (def.cycle) return `cycle ${def.cycle.sizes.length} sizes / ${def.cycle.every}s`
  if (def.brood) return `brood ${def.brood.count}`
  if (def.regen > 0) return `regen ${def.regen * 100}%/s`
  if (def.hitCap !== null) return `cap ${def.hitCap * 100}%/hit`
  if (def.escortedTaken < 1) return `escorted x${def.escortedTaken}`
  return 'none (baseline)'
}
