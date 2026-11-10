/**
 * Cross-tabulates rolled class against rolled tier.
 *
 * A roll draws the tier and the class from consecutive outputs of one PRNG. A
 * top tier means the first output landed in the extreme tail of [0, 1), so if
 * the generator has any correlation between consecutive outputs, the class
 * that follows an extreme value will be biased. This measures whether that is
 * happening.
 *
 *   npm run audit [rolls]
 */
import { CLASS_IDS } from '../core/data/classes'
import { TIERS, TIER_ORDER, tierFromRoll } from '../core/data/tiers'
import { Rng } from '../core/rng'
import type { ClassId, TierKey } from '../core/types'

const ROLLS = Number(process.argv[2] ?? 2_000_000)

type Table = Map<TierKey, Map<ClassId, number>>

function emptyTable(): Table {
  const t: Table = new Map()
  for (const tier of TIER_ORDER) {
    t.set(tier, new Map(CLASS_IDS.map((c) => [c, 0])))
  }
  return t
}

/** Exactly what game.ts does: one stream, two consecutive draws. */
function sharedStream(rolls: number): Table {
  const rng = new Rng(20260922)
  const table = emptyTable()
  for (let i = 0; i < rolls; i++) {
    const tier = tierFromRoll(rng.next())
    const classId = rng.pick(CLASS_IDS)
    const row = table.get(tier)!
    row.set(classId, row.get(classId)! + 1)
  }
  return table
}

/** Control: tier and class drawn from independent generators. */
function splitStreams(rolls: number): Table {
  const tierRng = new Rng(20260922)
  const classRng = new Rng(0x9e3779b9)
  const table = emptyTable()
  for (let i = 0; i < rolls; i++) {
    const tier = tierFromRoll(tierRng.next())
    const classId = classRng.pick(CLASS_IDS)
    const row = table.get(tier)!
    row.set(classId, row.get(classId)! + 1)
  }
  return table
}

function report(label: string, table: Table): void {
  console.log(`--- ${label}`)
  console.log('tier       total    archer     mage    ninja   max dev')

  for (const def of TIERS) {
    const row = table.get(def.key)!
    const total = CLASS_IDS.reduce((n, c) => n + row.get(c)!, 0)
    if (total === 0) continue

    const shares = CLASS_IDS.map((c) => row.get(c)! / total)
    const deviation = Math.max(...shares.map((s) => Math.abs(s - 1 / 3)))

    console.log(
      `${def.name.padEnd(8)} ${String(total).padStart(8)}   ` +
        shares.map((s) => `${(s * 100).toFixed(1)}%`.padStart(6)).join('  ') +
        `   ${(deviation * 100).toFixed(1)}pp${deviation > 0.05 ? '  <-- skewed' : ''}`,
    )
  }
  console.log()
}

console.log(`${ROLLS.toLocaleString()} rolls, expected 33.3% per class at every tier\n`)
report('shared stream (current game.ts)', sharedStream(ROLLS))
report('split streams (control)', splitStreams(ROLLS))
