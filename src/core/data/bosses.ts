import type { BossKey, MonsterSize, TierKey } from '../types'

/**
 * One boss every five waves, each keyed to a different system.
 *
 * A boss that is only a bigger health bar asks the same question six times, and
 * the answer is always "more DPS". Every trait here instead invalidates one way
 * of playing, so a roster that beat the last boss is not automatically the right
 * roster for the next one:
 *
 *   Gatekeeper   raw damage        the baseline, so the traits below read as traits
 *   Broodmother  the aftermath     dies into small monsters a large-killing board cannot clear
 *   Shifter      the size matrix   rotates its size, so one class covers it only a third of the time
 *   Warden       hit count         caps every single blow, which is the Mage's whole thing
 *   Revenant     sustained DPS     out-heals chip damage, so a wide-and-shallow board stalls
 *   Worldeater   the track itself  armoured until everything else is dead
 *
 * `hpFactor` pays for the trait: a trait that buys the boss time gets less
 * health, so the six fights come out roughly the same length for a board that
 * has the right answer, and much longer for one that does not.
 */
export type BossDef = {
  key: BossKey
  wave: number
  name: string
  /** Shown in the HUD the moment it spawns. A trait nobody can see is a bug. */
  tell: string
  size: MonsterSize
  /** Multiplies the wave's trash HP. */
  hpFactor: number
  /** Multiplies the wave's trash speed. */
  speedFactor: number

  /** Monsters released when it dies. Null for none. */
  brood: { count: number; size: MonsterSize; hpFactor: number } | null
  /** Fraction of max HP regained per second. */
  regen: number
  /**
   * Largest fraction of max HP one hit may deal. Null for uncapped.
   *
   * This is the mirror image of flat armour: flat armour would gut the Archer's
   * multi-hit, a per-hit cap guts the Mage's single heavy blow. One boss out of
   * six is allowed to punish one build.
   */
  hitCap: number | null
  /** Damage taken while any other monster is alive. 1 means no protection. */
  escortedTaken: number
  /**
   * Rotates its size class on a timer, so the matchup multiplier keeps moving.
   *
   * Speed was tried here first and turned out to be a no-op: projectiles home,
   * and a unit fires at whatever is inside its arc, so how fast a lone target
   * crosses that arc changes nothing about the damage it takes. Size is the one
   * property that actually moves the damage matrix.
   */
  cycle: { every: number; sizes: readonly MonsterSize[] } | null
  /** Tier of the free unit this boss's reward offers. */
  rewardTier: TierKey
  color: string
}

export const BOSSES: readonly BossDef[] = [
  {
    key: 'gatekeeper',
    wave: 5,
    name: 'Gatekeeper',
    tell: 'No tricks — just health.',
    size: 'large',
    hpFactor: 135,
    speedFactor: 0.75,
    brood: null,
    regen: 0,
    hitCap: null,
    escortedTaken: 1,
    cycle: null,
    rewardTier: 'relic',
    color: '#e879f9',
  },
  {
    key: 'broodmother',
    wave: 10,
    name: 'Broodmother',
    tell: 'Bursts into eight small monsters when it dies.',
    size: 'large',
    hpFactor: 68,
    speedFactor: 0.8,
    brood: { count: 8, size: 'small', hpFactor: 1 },
    regen: 0,
    hitCap: null,
    escortedTaken: 1,
    cycle: null,
    rewardTier: 'epic',
    color: '#fb923c',
  },
  {
    key: 'shifter',
    wave: 15,
    name: 'Shifter',
    tell: 'Cycles small, medium, large every three seconds.',
    size: 'small',
    hpFactor: 68,
    speedFactor: 1.4,
    brood: null,
    regen: 0,
    hitCap: null,
    escortedTaken: 1,
    cycle: { every: 3, sizes: ['small', 'medium', 'large'] },
    rewardTier: 'legend',
    color: '#22d3ee',
  },
  {
    key: 'warden',
    wave: 20,
    name: 'Warden',
    tell: 'No single blow takes more than 8% of it.',
    size: 'large',
    hpFactor: 28,
    speedFactor: 0.7,
    brood: null,
    regen: 0,
    hitCap: 0.08,
    escortedTaken: 1,
    cycle: null,
    rewardTier: 'legend',
    color: '#94a3b8',
  },
  {
    key: 'revenant',
    wave: 25,
    name: 'Revenant',
    tell: 'Heals 1% of its health every second.',
    size: 'large',
    hpFactor: 20,
    speedFactor: 0.9,
    brood: null,
    regen: 0.01,
    hitCap: null,
    escortedTaken: 1,
    cycle: null,
    rewardTier: 'myth',
    color: '#4ade80',
  },
  {
    key: 'worldeater',
    wave: 30,
    name: 'Worldeater',
    tell: 'Takes a quarter damage while anything else still circles.',
    size: 'large',
    hpFactor: 34,
    speedFactor: 0.8,
    brood: null,
    regen: 0,
    hitCap: null,
    escortedTaken: 0.25,
    cycle: null,
    rewardTier: 'primal',
    color: '#f87171',
  },
]

export const BOSS_BY_KEY: Record<BossKey, BossDef> = Object.fromEntries(
  BOSSES.map((b) => [b.key, b]),
) as Record<BossKey, BossDef>

/** The boss of a wave, or null on a trash wave. */
export function bossForWave(wave: number): BossDef | null {
  return BOSSES.find((b) => b.wave === wave) ?? null
}

/**
 * Upgrade points a boss's reward bundles.
 *
 * Kept small on purpose. Points are exponential, so a generous bundle would
 * make "take the points" the answer every time and collapse the three-way
 * choice into one.
 */
export function rewardPoints(wave: number): number {
  return 2 + Math.floor(wave / 10)
}

/**
 * Gold a boss's reward bundles — worth roughly 48 to 170 rolls.
 *
 * Priced against the other two options rather than against the economy: the
 * first pass paid 16-56 rolls, which lost to a free Legend and to exponential
 * points every single time, and a three-way choice with a dead third is a
 * two-way choice wearing a costume. At this size it buys a genuine re-roll of
 * the run, which is what a board with no champion actually needs.
 */
export function rewardGold(wave: number): number {
  return 120 + 24 * wave
}
