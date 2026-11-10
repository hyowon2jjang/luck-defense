/**
 * Headless balance simulator.
 *
 * Runs the core with no renderer, which is only possible because `core/` never
 * touches the DOM and all randomness flows through the seeded Rng.
 *
 * The balance target is a PAIR of numbers, not one:
 *
 *   heuristic policy -> ~20% clear rate   (skill has to matter)
 *   random policy    -> ~0-2% clear rate  (luck alone must not be enough)
 *
 * Hitting only one of them means the game is either pure luck or pure skill.
 *
 *   npm run sim [runs]
 */
import { ROLL_COST, createGame, dispatch, tick } from '../core/game'
import { CLASS_IDS } from '../core/data/classes'
import { ringCapacity } from '../core/systems/placement'
import { TIER_ORDER } from '../core/data/tiers'
import { TOTAL_MONSTERS, WAVE_COUNT } from '../core/data/waves'
import { Rng } from '../core/rng'
import { heuristicPolicy, monoPolicy, randomPolicy } from './policies'
import type { Policy } from './policies'
import type { RewardChoice, TierKey } from '../core/types'

const FIXED_DT = 1 / 60
const MAX_SIM_SECONDS = 60 * 60
/** How often a policy is allowed to act, in simulated seconds. */
const DECISION_INTERVAL = 0.5

type Result = {
  cleared: boolean
  wave: number
  kills: number
  rolls: number
  sells: number
  fielded: number
  bestTier: TierKey
  topUpgrade: number
  /** Boss rewards taken, split by option — reads how the choice is being used. */
  claims: Record<RewardChoice, number>
}

function simulate(policy: Policy, seed: number): Result {
  const state = createGame(seed)
  const policyRng = new Rng(seed ^ 0x9e3779b9)

  let seconds = 0
  let nextDecision = 0
  let rolls = 0
  let sells = 0
  const claims: Record<RewardChoice, number> = { unit: 0, points: 0, gold: 0 }

  while (state.phase === 'playing' && seconds < MAX_SIM_SECONDS) {
    if (seconds >= nextDecision) {
      nextDecision = seconds + DECISION_INTERVAL
      for (const cmd of policy.decide(state, policyRng)) {
        if (!dispatch(state, cmd)) continue
        if (cmd.kind === 'roll') rolls++
        if (cmd.kind === 'sell') sells++
        if (cmd.kind === 'claim') claims[cmd.choice]++
      }
    }
    tick(state, FIXED_DT)
    seconds += FIXED_DT
  }

  let bestRank = 0
  for (const u of state.units) bestRank = Math.max(bestRank, TIER_ORDER.indexOf(u.tier))

  return {
    cleared: state.phase === 'won',
    wave: state.wave,
    kills: state.kills,
    rolls,
    sells,
    fielded: state.units.length,
    bestTier: TIER_ORDER[bestRank],
    topUpgrade: Math.max(...Object.values(state.upgrades)),
    claims,
  }
}

function report(policy: Policy, runs: number): void {
  const results: Result[] = []
  for (let i = 0; i < runs; i++) results.push(simulate(policy, 1000 + i))

  const cleared = results.filter((r) => r.cleared).length
  const avg = (pick: (r: Result) => number) =>
    results.reduce((sum, r) => sum + pick(r), 0) / results.length

  const tierCounts = new Map<TierKey, number>()
  for (const r of results) tierCounts.set(r.bestTier, (tierCounts.get(r.bestTier) ?? 0) + 1)
  const tiers = TIER_ORDER.filter((t) => tierCounts.has(t))
    .map((t) => `${t} ${tierCounts.get(t)}`)
    .join('  ')

  console.log(`--- ${policy.name} (${runs} runs)`)
  console.log(`  clear rate   ${((cleared / runs) * 100).toFixed(1)}%`)
  console.log(`  avg wave     ${avg((r) => r.wave).toFixed(1)} / ${WAVE_COUNT}`)
  console.log(`  avg kills    ${avg((r) => r.kills).toFixed(0)} / ${TOTAL_MONSTERS}`)
  console.log(`  avg rolls    ${avg((r) => r.rolls).toFixed(0)}`)
  console.log(`  avg sells    ${avg((r) => r.sells).toFixed(0)}`)
  console.log(
    `  end roster   ${avg((r) => r.fielded).toFixed(0)} / ${ringCapacity()} units`,
  )
  console.log(`  avg top upg  ${avg((r) => r.topUpgrade).toFixed(1)}`)
  console.log(
    `  boss rewards unit ${avg((r) => r.claims.unit).toFixed(1)}  ` +
      `pts ${avg((r) => r.claims.points).toFixed(1)}  ` +
      `gold ${avg((r) => r.claims.gold).toFixed(1)}`,
  )
  console.log(`  best tier    ${tiers}`)
}

const runs = Number(process.argv[2] ?? 30)

console.log(`classes      ${CLASS_IDS.join(', ')}`)
console.log(`wave budget  ${TOTAL_MONSTERS} monsters -> ${TOTAL_MONSTERS / ROLL_COST} rolls max`)
console.log()

report(heuristicPolicy, runs)
console.log()
report(randomPolicy, runs)

// Opt-in: three single-class boards, to see whether the size matrix bites.
if (process.argv.includes('--mono')) {
  for (const classId of CLASS_IDS) {
    console.log()
    report(monoPolicy(classId), runs)
  }
}
