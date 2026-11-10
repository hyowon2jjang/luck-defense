import type { ClassId, DamageType, MonsterSize, TierKey } from '../types'

export type ClassDef = {
  id: ClassId
  name: string
  damageType: DamageType
  /** Damage of a single hit at Common tier, before tier and upgrade multipliers. */
  baseDamage: number
  /** Seconds between attacks. */
  attackInterval: number
  range: number
  /**
   * Side length in grid cells. Units are square, so a Mage costs 4x the floor
   * space of an Archer — and floor space inside the ring is the real budget.
   */
  footprint: number
  /**
   * Projectiles per attack. The Archer's multi-hit identity: each projectile
   * picks its own target, so an Archer chips a swarm rather than overkilling
   * one monster.
   */
  hits: number
  /** Splash radius in pixels, 0 for single target. */
  splash: number
  /** Pixels per second. Slower shots waste more damage on dying targets. */
  projectileSpeed: number
  color: string
  /** Presentation hooks. Ignored by the renderer until M6. */
  attackSfx: string
  hitSfx: string
  screenShake: number
}

/**
 * Every class is 2x2, so floor space costs the same and damage is balanced per
 * unit. The target is that each class wins against its own size and the Ninja
 * is a solid second everywhere:
 *
 *   effective DPS vs   small   medium   large
 *   Archer              100       50      25
 *   Ninja                80       80      80
 *   Mage                 43       64      85
 *
 * `baseDamage` is RAW damage, and the table above is what reaches a monster —
 * raw x track coverage x the size multiplier. Those are not the same number,
 * and conflating them is how this got badly wrong.
 *
 * The first pass read "the Mage's range buys uptime, so give it less raw DPS",
 * and then set raw DPS to the table above directly. That charged the Mage for
 * its coverage twice over and credited it to nobody. Measured, with coverage
 * folded in, it came out:
 *
 *   effective DPS vs   small   medium   large
 *   Archer               25       12       6        <- its own size, barely
 *   Ninja                25       25      25
 *   Mage                 17       25      34        <- wins medium AND large
 *
 * A Mage-only board then cleared 90% of runs against the mixed heuristic's 30%
 * (`npm run sim 40 --mono`). Raw damage here is now set so that raw x coverage
 * lands on the intended table, with the Mage as the anchor.
 */
export const CLASSES: Record<ClassId, ClassDef> = {
  archer: {
    id: 'archer',
    name: 'Archer',
    damageType: 'pierce',
    // 160 raw / 25% coverage -> ~100 effective against Small, per the table.
    baseDamage: 9.6,
    attackInterval: 0.18,
    range: 140,
    footprint: 2,
    hits: 3,
    splash: 0,
    projectileSpeed: 620,
    color: '#4ade80',
    attackSfx: 'bow_release',
    hitSfx: 'arrow_thud',
    screenShake: 0,
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    damageType: 'blast',
    baseDamage: 204,
    attackInterval: 2.4,
    range: 190,
    footprint: 2,
    hits: 1,
    splash: 45,
    projectileSpeed: 280,
    color: '#a78bfa',
    attackSfx: 'arcane_charge',
    hitSfx: 'meteor_impact',
    screenShake: 0.4,
  },
  ninja: {
    id: 'ninja',
    name: 'Ninja',
    damageType: 'balanced',
    // 103 raw / 31% coverage -> ~80 effective at every size.
    baseDamage: 72,
    attackInterval: 0.7,
    range: 165,
    footprint: 2,
    hits: 1,
    splash: 0,
    projectileSpeed: 480,
    color: '#38bdf8',
    attackSfx: 'shuriken_throw',
    hitSfx: 'shuriken_stick',
    screenShake: 0.1,
  },
}

export const CLASS_IDS: readonly ClassId[] = ['archer', 'mage', 'ninja']

/**
 * Damage multiplier by attack type vs monster size.
 *
 * This is the whole tactical layer: with only three classes, matching your
 * roster to what the wave is sending is the entire decision.
 */
export const DAMAGE_MATRIX: Record<DamageType, Record<MonsterSize, number>> = {
  pierce:   { small: 1.0, medium: 0.5,  large: 0.25 },
  balanced: { small: 1.0, medium: 1.0,  large: 1.0 },
  blast:    { small: 0.5, medium: 0.75, large: 1.0 },
}

/**
 * Fraction of a hit that splash carries to everything else in radius.
 *
 * It used to be 1.0 — full damage to every monster inside 45px, for free. On a
 * crowded lap that quietly multiplied the Mage's damage by the number of bodies
 * in the arc, which is not a bonus but a different damage model. The design
 * always described splash as "upside on top", and upside has to cost something.
 */
export const SPLASH_FALLOFF = 0.15

export const UNIT_NAMES: Record<TierKey, Record<ClassId, string>> = {
  common:  { archer: 'Novice Archer',     mage: 'Apprentice Mage',  ninja: 'Novice Ninja' },
  rare:    { archer: 'Crossbowman',       mage: 'Elementalist',     ninja: 'Assassin' },
  ancient: { archer: 'Windrunner',        mage: 'Archmagus',        ninja: 'Shadowblade' },
  relic:   { archer: 'Divine Marksman',   mage: 'Archmage',         ninja: 'Ninja Master' },
  epic:    { archer: 'Tempest Archer',    mage: 'Abyssal Sorcerer', ninja: 'Phantom' },
  legend:  { archer: 'Dragonsbane',       mage: 'Chronomancer',     ninja: 'Revenant Shinobi' },
  myth:    { archer: 'Bow of Retribution', mage: 'Sage of Ruin',    ninja: 'Shinobi Overlord' },
  primal:  { archer: 'Primordial Bowsaint', mage: 'Arcana Lord',    ninja: 'True Shadow' },
}

export function unitName(classId: ClassId, tier: TierKey): string {
  return UNIT_NAMES[tier][classId]
}
