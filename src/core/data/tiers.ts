import type { TierKey } from '../types'

export type TierDef = {
  key: TierKey
  name: string
  /** Roll probability. Must sum to exactly 1. */
  probability: number
  /** Damage multiplier applied on top of the class base damage. */
  damageMultiplier: number
  /**
   * Attack-rate multiplier, dividing the class's attack interval.
   *
   * A tier used to be one number — damage — so promoting a unit changed nothing
   * you could see. Splitting part of that power into rate makes a high tier
   * visibly faster on the board, because the tile's throw animation runs off
   * the real cooldown.
   *
   * It is a small, near-linear ladder while damage keeps the exponent. Rate
   * cannot carry much of the curve: the top tier is 18,000x the bottom, and a
   * unit firing eighteen thousand times faster is not a unit.
   */
  attackSpeed: number
  /**
   * Multiplies the class's splash radius. Only the Mage has one, so this is the
   * tier making its area of effect visibly grow rather than only its numbers.
   */
  splashScale: number
  /**
   * Fraction of a hit dealt to everything else inside the firing unit's range.
   *
   * Zero until Myth. From there a shot still lands hardest on what it aimed at,
   * but a weaker wave of it washes over the whole arc the unit covers — the
   * point at which a single unit stops being a single-target weapon.
   */
  lineShare: number
  /**
   * Gold to attempt promotion out of this tier. Null where enhancement is not
   * offered: the top tier, and the two bottom tiers — grinding Commons upward
   * one coin at a time is busywork, not a decision.
   */
  enhanceCost: number | null
  /** Chance that attempt succeeds. */
  enhanceChance: number
  color: string
}

/**
 * Roll table, taken from the original game's displayed rates.
 *
 * Those displayed values sum to 100.099% (rounding in their UI), so `common`
 * absorbs the remainder to make this sum to exactly 1.
 *
 * Damage multipliers are ~4x per tier as a starting point. The headless
 * simulator tunes these, not intuition.
 */
/**
 * Each tier's power is split between damage and attack rate, with the product
 * left exactly where it was: `damageMultiplier * attackSpeed` reproduces the
 * old damage ladder (1, 4, 16, 64, 260, 1,000, 4,200, 18,000) to within half a
 * percent. So the change is in what a promotion FEELS like, not in how strong
 * it is — which is also what makes any shift in the clear rate attributable to
 * the mechanics of firing faster (more overkill waste, more hits against the
 * Warden's per-hit cap) rather than to a power change.
 *
 * Enhancement replaced merging.
 *
 * Merging three units into one always paid off (tiers scale by 4x, merges cost
 * 3 units), so the roster collapsed to a handful of units and floor space,
 * placement priority and selling all stopped mattering. Enhancement consumes
 * gold instead of units: the roster stays full, and gold gains a second use —
 * roll wide, or pour everything into one champion.
 *
 * It starts at Ancient. Commons and Rares are roll fodder and sell material;
 * offering to enhance them would just add clicks to the early game.
 */
export const TIERS: readonly TierDef[] = [
  { key: 'common',  name: 'Common',  probability: 0.49901, damageMultiplier:     1, attackSpeed: 1.00, splashScale: 1.00, lineShare: 0, enhanceCost: null, enhanceChance: 0, color: '#c9d1d9' },
  { key: 'rare',    name: 'Rare',    probability: 0.332,   damageMultiplier:   3.7, attackSpeed: 1.08, splashScale: 1.03, lineShare: 0, enhanceCost: null, enhanceChance: 0, color: '#4ade80' },
  { key: 'ancient', name: 'Ancient', probability: 0.102,   damageMultiplier:  13.8, attackSpeed: 1.16, splashScale: 1.06, lineShare: 0, enhanceCost:  29, enhanceChance: 0.50, color: '#38bdf8' },
  { key: 'relic',   name: 'Relic',   probability: 0.051,   damageMultiplier:  51.2, attackSpeed: 1.25, splashScale: 1.10, lineShare: 0, enhanceCost:  55, enhanceChance: 0.45, color: '#fb923c' },
  { key: 'epic',    name: 'Epic',    probability: 0.010,   damageMultiplier:   195, attackSpeed: 1.34, splashScale: 1.14, lineShare: 0, enhanceCost: 104, enhanceChance: 0.40, color: '#f87171' },
  { key: 'legend',  name: 'Legend',  probability: 0.005,   damageMultiplier:   695, attackSpeed: 1.44, splashScale: 1.18, lineShare: 0, enhanceCost: 198, enhanceChance: 0.35, color: '#facc15' },
  { key: 'myth',    name: 'Myth',    probability: 0.0008,  damageMultiplier:  2710, attackSpeed: 1.55, splashScale: 1.22, lineShare: 0.18, enhanceCost: 376, enhanceChance: 0.30, color: '#f472b6' },
  { key: 'primal',  name: 'Primal',  probability: 0.00019, damageMultiplier: 10845, attackSpeed: 1.66, splashScale: 1.26, lineShare: 0.26, enhanceCost: null, enhanceChance: 0, color: '#a78bfa' },
]

export const TIER_BY_KEY: Record<TierKey, TierDef> = Object.fromEntries(
  TIERS.map((t) => [t.key, t]),
) as Record<TierKey, TierDef>

export const TIER_ORDER: readonly TierKey[] = TIERS.map((t) => t.key)

/** The tier three of `tier` merge into, or null if `tier` is the top. */
export function nextTier(tier: TierKey): TierKey | null {
  const i = TIER_ORDER.indexOf(tier)
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null
}

/** Cumulative distribution, precomputed once for rolls. */
const CUMULATIVE: readonly number[] = (() => {
  const out: number[] = []
  let acc = 0
  for (const t of TIERS) {
    acc += t.probability
    out.push(acc)
  }
  return out
})()

/** Maps a uniform [0, 1) sample to a tier. */
export function tierFromRoll(sample: number): TierKey {
  for (let i = 0; i < CUMULATIVE.length; i++) {
    if (sample < CUMULATIVE[i]) return TIERS[i].key
  }
  return TIERS[TIERS.length - 1].key
}
