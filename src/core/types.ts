import type { Rng } from './rng'

export type Vec2 = { x: number; y: number }

/** Attack type. Determines the damage multiplier against each monster size. */
export type DamageType = 'pierce' | 'balanced' | 'blast'

export type MonsterSize = 'small' | 'medium' | 'large'

export type ClassId = 'archer' | 'mage' | 'ninja'

export type TierKey =
  | 'common'
  | 'rare'
  | 'ancient'
  | 'relic'
  | 'epic'
  | 'legend'
  | 'myth'
  | 'primal'

export type BossKey =
  | 'gatekeeper'
  | 'broodmother'
  | 'shifter'
  | 'warden'
  | 'revenant'
  | 'worldeater'

export type Monster = {
  id: number
  size: MonsterSize
  /** Which boss this is, or null for trash. */
  boss: BossKey | null
  hp: number
  maxHp: number
  /** Pixels per second along the track. */
  speed: number
  /** Total distance travelled; wraps around the circle every lap. */
  distance: number
  pos: Vec2
  spawnedOnWave: number
  /** Elapsed seconds when it arrived. Drives the Shifter's size rotation. */
  spawnedAt: number
}

export type Unit = {
  id: number
  classId: ClassId
  tier: TierKey
  /** Grid cell index. Every unit is on the field — there is no bench. */
  cell: number | null
  /** Seconds until this unit can fire again. */
  cooldown: number
  /**
   * Radians toward whatever it last shot at, or null before its first shot.
   *
   * Stored rather than recomputed by the renderer: the aim is decided by the
   * same target selection the damage uses, so reading it back is the only way
   * the figure can be pointing at what it is actually hitting.
   */
  facing: number | null

  /** Career stats, for deciding what to keep and what to sell. */
  kills: number
  /** Damage actually landed — overkill is not counted. */
  damage: number
  recruitedOnWave: number
}

/**
 * In flight. Travel time is a design requirement, not flavour: a projectile
 * whose target dies before impact is wasted, which is what makes spreading
 * units around the track better than stacking them on one arc.
 */
export type Projectile = {
  id: number
  /** Unit that fired it, for crediting kills. May have been sold since. */
  ownerId: number
  x: number
  y: number
  targetId: number
  /** Damage before the size multiplier, snapshotted when fired. */
  damage: number
  damageType: DamageType
  splash: number
  speed: number
  /** 0-7. Carried so impacts can be drawn at the weight of the unit that fired. */
  tierRank: number
  /**
   * Top-tier line attack: on impact, everything within `lineRadius` of where
   * the shot was FIRED takes `lineShare` of it. Measured from the unit, not the
   * impact, so "inside its range" means the arc the unit actually covers —
   * which keeps placement load-bearing instead of making angle irrelevant.
   *
   * Zero below the tier that unlocks it.
   */
  originX: number
  originY: number
  lineRadius: number
  lineShare: number
}

export type GamePhase = 'playing' | 'won' | 'lost'

/**
 * One generator per kind of decision.
 *
 * Drawing the tier and the class from consecutive outputs of a single stream
 * couples them: a top tier means the first output landed in the extreme tail
 * of [0, 1), so any correlation between consecutive outputs would bias which
 * class follows a rare roll. Separate streams make that impossible by
 * construction rather than by trusting the generator.
 *
 * It also means adding a new random decision later cannot shift the existing
 * ones, so balance numbers stay comparable across versions.
 */
export type Streams = {
  tier: Rng
  unitClass: Rng
  enhance: Rng
}

export type GameState = {
  rng: Streams
  phase: GamePhase

  /** 1-based. */
  wave: number
  /** Seconds remaining in the current wave. */
  waveTimer: number
  /**
   * Hard deadline on the final wave. Null until wave 30 starts; from then on
   * the run is lost if it reaches zero with anything still alive.
   */
  finalTimer: number | null

  /** Spent on rolls only. Earned only by killing monsters. */
  gold: number
  /** Spent on upgrades only. Earned from wave clears and bosses. */
  points: number

  monsters: Monster[]
  units: Unit[]
  projectiles: Projectile[]
  upgrades: Record<DamageType, number>
  /** Boss rewards waiting to be claimed, oldest first. */
  rewards: RewardOffer[]

  kills: number
  /** Total laps completed by all monsters — a read on how long things survive. */
  laps: number

  enhanceAttempts: number
  enhanceSuccesses: number

  /** Elapsed simulated seconds. */
  elapsed: number

  nextEntityId: number
  spawnQueue: PendingSpawn[]
}

export type PendingSpawn = {
  at: number
  size: MonsterSize
  boss: BossKey | null
  hp: number
  speed: number
  wave: number
}

/**
 * A boss kill's three-way choice, one per currency.
 *
 * It waits instead of pausing: the wave clock never stops in this game, so a
 * modal that froze the board would be a new rule. An unclaimed offer simply
 * queues, and claiming late costs you whatever it would have been doing.
 *
 * The unit option grants the CLASS the player names — that choice is the point.
 * A Myth of the damage type you already upgraded wins the run; the same tier in
 * the wrong class is worth three gold.
 */
export type RewardOffer = {
  id: number
  wave: number
  boss: BossKey
  /** Tier of the free unit, whose class the player picks on claiming. */
  tier: TierKey
  points: number
  gold: number
}

export type RewardChoice = 'unit' | 'points' | 'gold'

export type Command =
  | { kind: 'roll' }
  /** Gamble gold on promoting one unit a tier. Failure costs only the gold. */
  | { kind: 'enhance'; unitId: number }
  | { kind: 'place'; unitId: number; cell: number }
  | { kind: 'upgrade'; damageType: DamageType }
  /** Liquidate a unit back into gold, to fund a single-build strategy. */
  | { kind: 'sell'; unitId: number }
  /** End the wave timer now. Trades breathing room for tempo. */
  | { kind: 'skip' }
  /** Take one of a boss reward's three options. `classId` only for 'unit'. */
  | { kind: 'claim'; offerId: number; choice: RewardChoice; classId?: ClassId }
