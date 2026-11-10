import { Rng } from './rng'
import { TRACK_LENGTH, trackAt } from './data/board'
import { BOSS_BY_KEY, rewardGold, rewardPoints } from './data/bosses'
import { TIER_BY_KEY, nextTier, tierFromRoll } from './data/tiers'
import {
  POINTS_PER_BOSS,
  POINTS_PER_WAVE,
  TRACK_LIMIT,
  WAVE_COUNT,
  WAVE_DURATION,
  waveDef,
} from './data/waves'
import { runCombat } from './systems/combat'
import {
  canPlaceUnit,
  firstFreeAnchor,
  hasRoom,
  unitsOverlapping,
} from './systems/placement'
import { CLASSES, CLASS_IDS } from './data/classes'
import type {
  ClassId,
  Command,
  DamageType,
  GameState,
  Monster,
  RewardChoice,
  TierKey,
  Unit,
} from './types'

/** Gold is earned one coin per kill, so this is also "5 kills per roll". */
export const ROLL_COST = 5
export const GOLD_PER_KILL = 1
export const STARTING_GOLD = 50
/**
 * Selling refunds less than a roll costs, so churning units is a real expense.
 * It exists so a run can liquidate everything off-build and commit to one
 * damage type instead of sitting on dead weight.
 */
export const SELL_REFUND = 3
/**
 * Skip pays for the wave clock it gives up, per second, scaling with the wave.
 *
 * It used to pay per monster still circling, which made it a gamble: nothing on
 * a clean track, a fortune on a crowded one. That version rewarded taking on
 * overlap rather than being ahead. Paying for time inverts it — the reward is
 * largest when the board is already comfortable enough to call the wave early.
 *
 * The spawn window still gates it: a wave cannot be skipped until it has
 * finished arriving, which is 65% of the clock, so the most that is ever on
 * offer is the last ~10 seconds.
 */
export const SKIP_RATE_BASE = 0.3
export const SKIP_RATE_PER_WAVE = 0.04
/** The final wave is a hard deadline, not another 30-second tick. */
export const FINAL_WAVE_SECONDS = 180
/** Fraction of the wave spent spawning; the rest is time to finish them off. */
const SPAWN_WINDOW = 0.65
/** Track pixels between the monsters a Broodmother leaves behind. */
const BROOD_SPACING = 16

/** Distinct offsets so the three streams never share a position. */
const STREAM_TIER = 0
const STREAM_CLASS = 0x9e3779b9
const STREAM_ENHANCE = 0x85ebca6b

export function createGame(seed: number): GameState {
  const state: GameState = {
    rng: {
      tier: new Rng((seed ^ STREAM_TIER) >>> 0),
      unitClass: new Rng((seed ^ STREAM_CLASS) >>> 0),
      enhance: new Rng((seed ^ STREAM_ENHANCE) >>> 0),
    },
    phase: 'playing',
    wave: 1,
    waveTimer: WAVE_DURATION,
    finalTimer: null,
    gold: STARTING_GOLD,
    points: 0,
    monsters: [],
    units: [],
    projectiles: [],
    upgrades: { pierce: 0, balanced: 0, blast: 0 },
    rewards: [],
    kills: 0,
    laps: 0,
    enhanceAttempts: 0,
    enhanceSuccesses: 0,
    elapsed: 0,
    nextEntityId: 1,
    spawnQueue: [],
  }
  queueWave(state, 1)
  return state
}

function queueWave(state: GameState, wave: number): void {
  const def = waveDef(wave)
  const window = WAVE_DURATION * SPAWN_WINDOW
  const gap = def.count > 1 ? window / def.count : 0

  for (let i = 0; i < def.count; i++) {
    state.spawnQueue.push({
      at: state.elapsed + i * gap,
      size: def.pattern[i % def.pattern.length],
      boss: def.boss,
      hp: def.hp,
      speed: def.speed,
      wave,
    })
  }
}

/**
 * Advances the simulation. Always called with a fixed dt (1/60) so results do
 * not depend on the renderer's frame rate.
 */
export function tick(state: GameState, dt: number): void {
  if (state.phase !== 'playing') return

  state.elapsed += dt

  while (state.spawnQueue.length > 0 && state.spawnQueue[0].at <= state.elapsed) {
    const pending = state.spawnQueue.shift()!
    state.monsters.push({
      id: state.nextEntityId++,
      size: pending.size,
      boss: pending.boss,
      hp: pending.hp,
      maxHp: pending.hp,
      speed: pending.speed,
      distance: 0,
      pos: trackAt(0),
      spawnedOnWave: pending.wave,
      spawnedAt: state.elapsed,
    })
  }

  // The track is a closed circle, so a monster you fail to kill keeps coming
  // around — that accumulation is the whole point of the wave timer.
  for (const m of state.monsters) {
    const before = Math.floor(m.distance / TRACK_LENGTH)
    m.distance += m.speed * dt
    if (Math.floor(m.distance / TRACK_LENGTH) > before) state.laps++
    m.pos = trackAt(m.distance)
  }

  shiftSizes(state)
  regenerate(state, dt)
  runCombat(state, dt)
  collectDead(state)

  // Wave clock. Survivors are NOT cleared — they carry into the next wave.
  // The point is only paid on an actual advance, so parking on the final wave
  // cannot farm points.
  state.waveTimer -= dt
  if (state.waveTimer <= 0) {
    state.waveTimer = WAVE_DURATION
    if (state.wave < WAVE_COUNT) {
      state.points += POINTS_PER_WAVE
      state.wave++
      queueWave(state, state.wave)
      if (state.wave === WAVE_COUNT) state.finalTimer = FINAL_WAVE_SECONDS
    }
  }

  if (state.finalTimer !== null) state.finalTimer -= dt

  if (state.monsters.length > TRACK_LIMIT) {
    state.phase = 'lost'
    return
  }

  if (
    state.wave >= WAVE_COUNT &&
    state.monsters.length === 0 &&
    state.spawnQueue.length === 0
  ) {
    state.phase = 'won'
    return
  }

  // Final boss deadline. Checked after the win so a same-frame kill counts.
  if (state.finalTimer !== null && state.finalTimer <= 0) {
    state.phase = 'lost'
  }
}

/**
 * The Shifter's size rotation.
 *
 * Derived from elapsed time rather than a countdown on the monster, so it stays
 * a pure function of the state and two runs of one seed always shift on the
 * same tick. Projectiles already in flight land against whatever size it is at
 * impact, which is the point: the shot you fired at a Large may arrive at a
 * Small.
 */
function shiftSizes(state: GameState): void {
  for (const m of state.monsters) {
    if (m.boss === null) continue
    const cycle = BOSS_BY_KEY[m.boss].cycle
    if (cycle === null) continue

    const step = Math.floor((state.elapsed - m.spawnedAt) / cycle.every)
    m.size = cycle.sizes[step % cycle.sizes.length]
  }
}

/**
 * The Revenant's healing, run before combat so a tick's damage is always
 * measured against the health it just restored.
 *
 * It is a floor on damage-per-second, not on total damage: a board that cannot
 * out-pace 3% a second never kills it however long the wave runs.
 */
function regenerate(state: GameState, dt: number): void {
  for (const m of state.monsters) {
    if (m.boss === null || m.hp <= 0 || m.hp >= m.maxHp) continue
    const regen = BOSS_BY_KEY[m.boss].regen
    if (regen > 0) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * regen * dt)
  }
}

function collectDead(state: GameState): void {
  for (let i = state.monsters.length - 1; i >= 0; i--) {
    const m = state.monsters[i]
    if (m.hp > 0) continue

    state.monsters.splice(i, 1)
    state.kills++
    state.gold += GOLD_PER_KILL
    if (m.boss !== null) killBoss(state, m)
  }
}

/**
 * A boss death pays the flat point bounty, releases its brood, and queues the
 * three-way reward. The brood spawns from the corpse's position, not the start
 * of the track, so the monsters that killed it are the ones still in range.
 */
function killBoss(state: GameState, boss: Monster): void {
  const def = BOSS_BY_KEY[boss.boss!]
  state.points += POINTS_PER_BOSS

  if (def.brood) {
    const wave = waveDef(boss.spawnedOnWave)
    const hp = Math.round(wave.trashHp * def.brood.hpFactor)
    for (let i = 0; i < def.brood.count; i++) {
      // Strung out behind the corpse so they are not one stacked target.
      // Wrapped rather than clamped: distance also drives the lap counter.
      const behind = boss.distance - i * BROOD_SPACING
      const distance = behind < 0 ? behind + TRACK_LENGTH : behind

      state.monsters.push({
        id: state.nextEntityId++,
        size: def.brood.size,
        boss: null,
        hp,
        maxHp: hp,
        distance,
        speed: wave.speed,
        pos: trackAt(distance),
        spawnedOnWave: boss.spawnedOnWave,
        spawnedAt: state.elapsed,
      })
    }
  }

  state.rewards.push({
    id: state.nextEntityId++,
    wave: boss.spawnedOnWave,
    boss: def.key,
    tier: def.rewardTier,
    points: rewardPoints(boss.spawnedOnWave),
    gold: rewardGold(boss.spawnedOnWave),
  })
}

/**
 * Claim one of a reward's three options.
 *
 * A unit claim with no room on the ring fails and leaves the offer queued
 * rather than silently converting to gold — same rule as a roll, so "sell
 * something first" stays the one answer to a full board.
 */
function claim(
  state: GameState,
  offerId: number,
  choice: RewardChoice,
  classId?: ClassId,
): boolean {
  const index = state.rewards.findIndex((r) => r.id === offerId)
  if (index < 0) return false
  const offer = state.rewards[index]

  if (choice === 'unit') {
    if (classId === undefined || !hasRoom(state)) return false
    const unit = addUnit(state, classId, offer.tier)
    unit.cell = firstFreeAnchor(state, classId, unit.id)
  } else if (choice === 'points') {
    state.points += offer.points
  } else {
    state.gold += offer.gold
  }

  state.rewards.splice(index, 1)
  return true
}

export function dispatch(state: GameState, cmd: Command): boolean {
  if (state.phase !== 'playing') return false

  switch (cmd.kind) {
    case 'roll':
      return roll(state) !== null
    case 'enhance':
      return enhance(state, cmd.unitId)
    case 'place':
      return place(state, cmd.unitId, cmd.cell)
    case 'upgrade':
      return upgrade(state, cmd.damageType)
    case 'sell':
      return sell(state, cmd.unitId)
    case 'skip':
      return skip(state)
    case 'claim':
      return claim(state, cmd.offerId, cmd.choice, cmd.classId)
  }
}

function sell(state: GameState, unitId: number): boolean {
  const index = state.units.findIndex((u) => u.id === unitId)
  if (index < 0) return false

  state.units.splice(index, 1)
  state.gold += SELL_REFUND
  return true
}

/**
 * Ends the wait, not the wave: the next wave's monsters arrive immediately on
 * top of whatever is still circling.
 *
 * The cost is still real — the next wave lands on whatever is left of this one —
 * but the payment is now for the clock surrendered, so later waves pay more for
 * the same seconds.
 */
export function canSkip(state: GameState): boolean {
  if (state.phase !== 'playing') return false
  if (state.wave >= WAVE_COUNT) return false
  // Only the waiting can be skipped, never the spawning. Without this, holding
  // the button marches through all thirty waves in a few seconds.
  return state.spawnQueue.length === 0
}

export function skipBounty(state: GameState): number {
  if (!canSkip(state)) return 0
  const rate = SKIP_RATE_BASE + SKIP_RATE_PER_WAVE * state.wave
  return Math.round(Math.max(0, state.waveTimer) * rate)
}

function skip(state: GameState): boolean {
  if (!canSkip(state)) return false
  state.gold += skipBounty(state)
  state.waveTimer = 0
  return true
}

function roll(state: GameState): Unit | null {
  if (state.gold < ROLL_COST) return null
  // No bench: a unit with nowhere to stand cannot be recruited at all. Selling
  // is what makes room.
  if (!hasRoom(state)) return null

  state.gold -= ROLL_COST

  const tier = tierFromRoll(state.rng.tier.next())
  const classId = state.rng.unitClass.pick(CLASS_IDS)
  const unit = addUnit(state, classId, tier)

  // Fill the interior from the middle outwards. Fine positioning is manual.
  unit.cell = firstFreeAnchor(state, classId, unit.id)
  return unit
}

/**
 * Gamble gold on promoting one unit a tier.
 *
 * Returns true whenever the attempt was made — the gold is spent either way.
 * Whether it actually promoted is read from the unit's tier, or from
 * `enhanceSuccesses`.
 */
function enhance(state: GameState, unitId: number): boolean {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit) return false

  const tier = TIER_BY_KEY[unit.tier]
  const target = nextTier(unit.tier)
  if (target === null || tier.enhanceCost === null) return false
  if (state.gold < tier.enhanceCost) return false

  state.gold -= tier.enhanceCost
  state.enhanceAttempts++

  if (state.rng.enhance.chance(tier.enhanceChance)) {
    unit.tier = target
    state.enhanceSuccesses++
  }
  return true
}

/**
 * Move a unit, swapping with at most one occupant.
 *
 * With no bench there is nowhere to displace a unit to, so a move that would
 * cover two or more units is simply refused. Overlapping exactly one is a
 * swap: that unit takes the anchor this one is vacating, which is free and
 * legal by construction.
 */
function place(state: GameState, unitId: number, cell: number): boolean {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.cell === null || !canPlaceUnit(unit, cell)) return false

  const size = CLASSES[unit.classId].footprint
  const overlapping = unitsOverlapping(state, cell, size, unit.id)
  if (overlapping.length > 1) return false

  if (overlapping.length === 1) {
    const other = overlapping[0]
    if (!canPlaceUnit(other, unit.cell)) return false
    other.cell = unit.cell
  }

  unit.cell = cell
  return true
}

/**
 * Upgrade points are a separate currency from gold, so rolling and upgrading
 * never compete for the same resource. Points can be banked but never refunded.
 */
function upgrade(state: GameState, damageType: DamageType): boolean {
  if (state.points < 1) return false
  state.points--
  state.upgrades[damageType]++
  return true
}

function addUnit(state: GameState, classId: ClassId, tier: TierKey): Unit {
  const unit: Unit = {
    id: state.nextEntityId++,
    classId,
    tier,
    cell: null,
    cooldown: 0,
    facing: null,
    kills: 0,
    damage: 0,
    recruitedOnWave: state.wave,
  }
  state.units.push(unit)
  return unit
}
