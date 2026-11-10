/**
 * The two policies the balance target is measured against.
 *
 * They live apart from the simulator because more than one tool plays games:
 * `headless.ts` counts clear rates, `boss-report.ts` watches what happens to
 * each boss. Both have to be driven by the SAME heuristic or their numbers
 * describe different games.
 */
import { ROLL_COST } from '../core/game'
import { CLASSES, CLASS_IDS } from '../core/data/classes'
import { hasRoom, ringCapacity } from '../core/systems/placement'
import { TIERS, TIER_BY_KEY, TIER_ORDER } from '../core/data/tiers'
import { TRACK_LIMIT } from '../core/data/waves'
import { Rng } from '../core/rng'
import type {
  ClassId,
  Command,
  DamageType,
  GameState,
  RewardChoice,
  TierKey,
  Unit,
} from '../core/types'

export type Policy = {
  name: string
  decide(state: GameState, rng: Rng): Command[]
}

const CHOICES: RewardChoice[] = ['unit', 'points', 'gold']

/** Lower bound: button mashing. Should almost never clear. */
export const randomPolicy: Policy = {
  name: 'random',
  decide(state, rng) {
    const out: Command[] = []
    if (state.gold >= ROLL_COST && rng.chance(0.5)) out.push({ kind: 'roll' })
    if (state.points >= 1 && rng.chance(0.5)) {
      const types: DamageType[] = ['pierce', 'balanced', 'blast']
      out.push({ kind: 'upgrade', damageType: rng.pick(types) })
    }

    // Takes a reward, but with no read on which one it needs — which is the
    // whole point of the three-way choice.
    const offer = state.rewards[0]
    if (offer) {
      out.push({
        kind: 'claim',
        offerId: offer.id,
        choice: rng.pick(CHOICES),
        classId: rng.pick(CLASS_IDS as ClassId[]),
      })
    }
    return out
  },
}

/**
 * Upper bound: plays the decisions that actually matter.
 *
 *  - Rolls whenever it can. Gold has no other use.
 *  - Banks upgrade points until a Relic-or-better unit shows up, then commits
 *    every point to that unit's damage type and never diversifies.
 *  - Skips the wait once the track is empty. Free tempo, no risk.
 *  - Sells its weakest unit to clear space when the ring is full. There is no
 *    bench, so selling is the only way to keep recruiting.
 *  - Buys width first, then depth. Gold comes only from kills, so a thin board
 *    earns nothing — it fills the ring before spending anything on enhancing
 *    its champion.
 *  - Reads boss rewards against what it already holds (see `claimReward`).
 */
const SELL_GAP = 3
/** Fill the ring before buying depth. */
const FIELD_TARGET = ringCapacity()
/**
 * Monsters on track above which calling a wave early is not worth the risk.
 *
 * Measured against the loss line, not the HUD's warning colour. It was derived
 * from TRACK_WARN, which meant moving a warning threshold — a presentation
 * decision — silently retuned the policy and therefore the clear rate.
 */
const SKIP_CEILING = Math.floor(TRACK_LIMIT * 0.48)
const COMMIT_TIER = TIER_ORDER.indexOf('relic')

export const heuristicPolicy: Policy = {
  name: 'heuristic',
  decide(state) {
    const out: Command[] = []
    const bestRank = topRank(state)
    const fielded = state.units.length
    const full = !hasRoom(state)

    const commitment = bestClass(state)

    // Sells first: the gold and the space they free serve the commands after.
    //
    // Off-class units go before weak ones. Upgrade points are exponential and
    // can only go to one damage type, so a unit of another class is not a
    // weaker unit — it is a unit outside the only multiplier that matters.
    // Measured: a board that commits and clears out beat this policy's older
    // mixed roster at every class (`npm run sim --mono`), which meant the
    // "skilled" upper bound was being measured on confused play.
    if (full) {
      const offClass =
        commitment === null
          ? null
          : state.units.find((u) => u.classId !== commitment) ?? null
      const weakest = weakestUnit(state)

      if (offClass) {
        out.push({ kind: 'sell', unitId: offClass.id })
      } else if (weakest && TIER_ORDER.indexOf(weakest.tier) <= bestRank - SELL_GAP) {
        out.push({ kind: 'sell', unitId: weakest.id })
      }
    }

    const champion = bestUnit(state)
    const enhanceCost = champion ? TIER_BY_KEY[champion.tier].enhanceCost : null
    const canEnhance =
      fielded >= FIELD_TARGET &&
      champion !== null &&
      enhanceCost !== null &&
      bestRank >= COMMIT_TIER

    if (canEnhance && state.gold >= (enhanceCost as number)) {
      out.push({ kind: 'enhance', unitId: (champion as Unit).id })
    } else if (state.gold >= ROLL_COST) {
      out.push({ kind: 'roll' })
    }

    // Call the next wave early while there is still a bounty to collect, but
    // stay clear of the saturation limit.
    if (state.monsters.length <= SKIP_CEILING) out.push({ kind: 'skip' })

    if (commitment && state.points >= 1) {
      out.push({ kind: 'upgrade', damageType: CLASSES[commitment].damageType })
    }

    const offer = state.rewards[0]
    if (offer) out.push(claimReward(state, offer, commitment))

    return out
  },
}

/**
 * Expected damage multiplier from one roll, averaged over the tier table.
 *
 * Used to price the gold option. A roll is only worth this much when there is
 * somewhere to put the unit, which is why the caller zeroes it on a full ring.
 */
const ROLL_VALUE = TIERS.reduce((sum, t) => sum + t.probability * t.damageMultiplier, 0)

/**
 * Values all three reward options in one unit — total damage multiplier added
 * to the committed class — and takes the best.
 *
 * The first version hardcoded "unit, then points, then gold" and so never once
 * chose gold in a hundred runs. That is not evidence that gold is a bad option;
 * it is evidence that nothing was comparing them. Pricing them answers the
 * question the preference order was hiding.
 */
function claimReward(
  state: GameState,
  offer: { id: number; tier: TierKey; points: number; gold: number },
  commitment: ClassId | null,
): Command {
  // Everything is measured against the power already committed, because that
  // is what points multiply and what another unit of the class adds to.
  const onType = commitment
    ? state.units.filter((u) => u.classId === commitment)
    : state.units
  const committedPower = onType.reduce(
    (sum, u) => sum + TIER_BY_KEY[u.tier].damageMultiplier,
    0,
  )

  const free = Math.max(0, ringCapacity() - state.units.length)

  // A full ring does not make the unit worthless — it makes it cost the weakest
  // thing on the board, which late in a run is a Common worth almost nothing.
  const weakest = weakestUnit(state)
  const displaced =
    free > 0 || weakest === null ? 0 : TIER_BY_KEY[weakest.tier].damageMultiplier
  const unitValue = TIER_BY_KEY[offer.tier].damageMultiplier - displaced

  const pointValue = committedPower * (Math.pow(1.1, offer.points) - 1)

  // Gold buys rolls, but a roll is only worth anything if there is somewhere to
  // stand. Pricing the whole purse ignored that and made gold look enormous on
  // a nearly full board.
  const goldValue = Math.min(offer.gold / ROLL_COST, free) * ROLL_VALUE

  const best = Math.max(unitValue, pointValue, goldValue)

  if (best === unitValue && unitValue > 0) {
    // Uncommitted means no upgrades are riding on a type yet, so the Ninja's
    // flat matchups are the safest thing to be handed.
    return { kind: 'claim', offerId: offer.id, choice: 'unit', classId: commitment ?? 'ninja' }
  }
  return {
    kind: 'claim',
    offerId: offer.id,
    choice: best === pointValue ? 'points' : 'gold',
  }
}

/**
 * The heuristic, restricted to one class — it sells everything else on sight.
 *
 * This exists to test a premise rather than to play well. The whole size matrix,
 * and the wave composition table built on top of it, assume a mono-class board
 * has holes that a mixed one does not. If these three clear at the same rate as
 * the mixed heuristic, the matchup table is decoration.
 */
export function monoPolicy(only: ClassId): Policy {
  return {
    name: `${only}-only`,
    decide(state, rng) {
      const offTeam = state.units.find((u) => u.classId !== only)
      if (offTeam) return [{ kind: 'sell', unitId: offTeam.id }]

      const out = heuristicPolicy.decide(state, rng)
      // Rewards must come in the one class it is allowed to field.
      return out.map((cmd) =>
        cmd.kind === 'claim' && cmd.choice === 'unit' ? { ...cmd, classId: only } : cmd,
      )
    },
  }
}

export function bestUnit(state: GameState): Unit | null {
  let best: Unit | null = null
  let bestRank = -1
  for (const u of state.units) {
    const rank = TIER_ORDER.indexOf(u.tier)
    if (rank > bestRank) {
      bestRank = rank
      best = u
    }
  }
  return best
}

function weakestUnit(state: GameState): Unit | null {
  let worst: Unit | null = null
  let worstRank = Infinity
  for (const u of state.units) {
    const rank = TIER_ORDER.indexOf(u.tier)
    if (rank < worstRank) {
      worstRank = rank
      worst = u
    }
  }
  return worst
}

export function topRank(state: GameState): number {
  let best = 0
  for (const u of state.units) best = Math.max(best, TIER_ORDER.indexOf(u.tier))
  return best
}

/** The class holding the highest-tier unit, once it is worth committing to. */
function bestClass(state: GameState): ClassId | null {
  const best = bestUnit(state)
  if (best === null) return null
  return TIER_ORDER.indexOf(best.tier) >= COMMIT_TIER ? best.classId : null
}
