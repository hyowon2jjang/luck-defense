import { CLASSES, CLASS_IDS, DAMAGE_MATRIX, SPLASH_FALLOFF } from '../data/classes'
import { coverage, placeableAnchors, radiusOf, unitCenter } from '../data/board'
import { BOSS_BY_KEY } from '../data/bosses'
import { TIER_BY_KEY, TIER_ORDER } from '../data/tiers'
import type { ClassId, GameState, Monster, Projectile, Unit } from '../types'


/**
 * Seconds between this unit's attacks, after its tier's rate bonus.
 *
 * Everything that needs the attack rate goes through here — combat, the DPS
 * readout, and the throw animation — so the figure on the board cannot drift
 * out of step with when it actually fires.
 */
/**
 * Per-class correction for the line attack, so range does not decide it.
 *
 * The line reaches everything inside the unit's range, which sounds even until
 * you remember the monsters are on a one-dimensional track. What a shot catches
 * scales with the ARC covered, not the area — and the arcs are 25% / 31% / 40%
 * for Archer / Ninja / Mage. The same 18% share therefore swept 1.6x as many
 * bodies for a Mage, and the measured mono-class rates said so plainly: Mage
 * 27%, Ninja 19%, Archer 5%.
 *
 * Normalising by peak coverage equalises what the share is worth without
 * touching the radius, so placement still decides how much of it a unit
 * actually gets — a badly placed unit still sweeps a short arc.
 */
const LINE_SCALE: Record<ClassId, number> = (() => {
  const peak = (classId: ClassId) => {
    const def = CLASSES[classId]
    let best = 0
    for (const anchor of placeableAnchors(def.footprint)) {
      best = Math.max(best, coverage(radiusOf(anchor, def.footprint), def.range))
    }
    return best
  }

  const reference = peak('ninja')
  const out = {} as Record<ClassId, number>
  for (const id of CLASS_IDS) out[id] = reference / peak(id)
  return out
})()

export function attackInterval(unit: Unit): number {
  return CLASSES[unit.classId].attackInterval / TIER_BY_KEY[unit.tier].attackSpeed
}

/** Damage one projectile from this unit carries, before the size multiplier. */
export function projectileDamage(state: GameState, unit: Unit): number {
  const def = CLASSES[unit.classId]
  return (
    def.baseDamage *
    TIER_BY_KEY[unit.tier].damageMultiplier *
    upgradeMultiplier(state.upgrades[def.damageType])
  )
}

/**
 * Exponential, not linear.
 *
 * With a linear track an unupgraded Myth unit beats a fully upgraded Relic,
 * which breaks the "Myth AND 40 upgrades" clear condition. Exponential makes
 * the last points the most valuable, so concentrating on one damage type is
 * forced — and choosing which type, and when, is the core decision.
 */
export function upgradeMultiplier(level: number): number {
  return Math.pow(1.1, level)
}

export function runCombat(state: GameState, dt: number): void {
  const monstersById = new Map<number, Monster>()
  for (const m of state.monsters) monstersById.set(m.id, m)

  const unitsById = new Map<number, Unit>()
  for (const u of state.units) unitsById.set(u.id, u)

  // Counted once per tick rather than per hit: the Worldeater's shield reads
  // "is anything else alive", and a boss fight can land hundreds of hits a
  // second. Resolving it at tick granularity keeps it O(n) and deterministic.
  let alive = 0
  for (const m of state.monsters) if (m.hp > 0) alive++

  fireUnits(state, dt)
  advanceProjectiles(state, dt, monstersById, unitsById, alive)
}

function fireUnits(state: GameState, dt: number): void {
  if (state.monsters.length === 0) return

  for (const unit of state.units) {
    if (unit.cell === null) continue

    unit.cooldown -= dt
    if (unit.cooldown > 0) continue

    const def = CLASSES[unit.classId]
    const origin = unitCenter(unit.cell, def.footprint)
    const targets = pickTargets(state, origin.x, origin.y, def.range, def.hits)

    if (targets.length === 0) {
      // Ready but nothing in range. Stay ready rather than banking cooldown.
      unit.cooldown = 0
      continue
    }

    // Aim at the nearest of the chosen targets, which is the one the sprite
    // should be turned toward.
    unit.facing = Math.atan2(targets[0].pos.y - origin.y, targets[0].pos.x - origin.x)

    const damage = projectileDamage(state, unit)
    const tier = TIER_BY_KEY[unit.tier]
    const rank = TIER_ORDER.indexOf(unit.tier)

    for (let i = 0; i < def.hits; i++) {
      const target = targets[i % targets.length]
      state.projectiles.push({
        id: state.nextEntityId++,
        ownerId: unit.id,
        x: origin.x,
        y: origin.y,
        targetId: target.id,
        damage,
        damageType: def.damageType,
        // Tier widens the blast as well as deepening it.
        splash: def.splash * tier.splashScale,
        speed: def.projectileSpeed,
        tierRank: rank,
        originX: origin.x,
        originY: origin.y,
        lineRadius: tier.lineShare > 0 ? def.range : 0,
        lineShare: tier.lineShare * LINE_SCALE[unit.classId],
      })
    }
    unit.cooldown = attackInterval(unit)
  }
}

/**
 * Up to `want` distinct monsters in range, nearest first.
 *
 * Spreading an Archer's three shots across three targets is what makes it a
 * swarm-clearer rather than a single-target unit that overkills.
 *
 * This is the hottest loop in the game: it runs once per unit per attack, and
 * a full ring of Archers attacks about 340 times a second. The first version
 * built an array of objects for everything in range and sorted it, which meant
 * an allocation and an O(n log n) for a query that wants at most three. This
 * keeps a running top-`want` instead — no allocation beyond the result, one
 * pass, and the same answer: ties still resolve to whichever monster the list
 * reached first, exactly as a stable sort did.
 */
const picked: Monster[] = []
const pickedDist: number[] = []

function pickTargets(
  state: GameState,
  x: number,
  y: number,
  range: number,
  want: number,
): Monster[] {
  const rangeSq = range * range
  let count = 0

  for (const m of state.monsters) {
    if (m.hp <= 0) continue
    const dx = m.pos.x - x
    const dy = m.pos.y - y
    const d = dx * dx + dy * dy
    if (d > rangeSq) continue

    // Strictly-greater keeps the insert after equals, which is what made the
    // old stable sort break ties by list order.
    if (count === want && d >= pickedDist[count - 1]) continue

    let at = count < want ? count++ : want - 1
    while (at > 0 && pickedDist[at - 1] > d) {
      picked[at] = picked[at - 1]
      pickedDist[at] = pickedDist[at - 1]
      at--
    }
    picked[at] = m
    pickedDist[at] = d
  }

  return picked.slice(0, count)
}

function advanceProjectiles(
  state: GameState,
  dt: number,
  monstersById: Map<number, Monster>,
  unitsById: Map<number, Unit>,
  alive: number,
): void {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i]
    const target = monstersById.get(p.targetId)

    // Target died mid-flight: the shot is wasted. This is the overkill cost
    // that makes stacking units on one arc worse than spreading them out.
    if (!target || target.hp <= 0) {
      state.projectiles.splice(i, 1)
      continue
    }

    const dx = target.pos.x - p.x
    const dy = target.pos.y - p.y
    const dist = Math.hypot(dx, dy)
    const step = p.speed * dt

    if (dist <= step) {
      // The owner may have been sold mid-flight; the shot still lands.
      impact(state, p, target, unitsById.get(p.ownerId) ?? null, alive)
      state.projectiles.splice(i, 1)
    } else {
      p.x += (dx / dist) * step
      p.y += (dy / dist) * step
    }
  }
}

function impact(
  state: GameState,
  p: Projectile,
  target: Monster,
  owner: Unit | null,
  alive: number,
): void {
  applyDamage(p, target, owner, alive, 1)

  if (p.splash <= 0) return

  // Splash carries the same type multiplier, so a Mage's area damage is still
  // weak against small monsters. That is what keeps it out of the Archer's job.
  const splashSq = p.splash * p.splash
  for (const m of state.monsters) {
    if (m === target || m.hp <= 0) continue
    const dx = m.pos.x - target.pos.x
    const dy = m.pos.y - target.pos.y
    if (dx * dx + dy * dy <= splashSq) applyDamage(p, m, owner, alive, SPLASH_FALLOFF)
  }
}

function applyDamage(
  p: Projectile,
  monster: Monster,
  owner: Unit | null,
  alive: number,
  /** 1 for the monster actually hit, less for everything splash reaches. */
  share: number,
): void {
  if (monster.hp <= 0) return

  const damage = bossAdjusted(
    p.damage * DAMAGE_MATRIX[p.damageType][monster.size] * share,
    monster,
    alive,
  )
  // Credit only what actually landed, so the stat does not reward overkill.
  const landed = Math.min(damage, monster.hp)
  monster.hp -= damage

  if (owner) {
    owner.damage += landed
    if (monster.hp <= 0) owner.kills++
  }
}

/**
 * Boss defences, applied after the size multiplier.
 *
 * Both are deliberately expressed against the boss's own max HP rather than as
 * flat numbers, so they mean the same thing at wave 20 as at wave 30 and never
 * need retuning alongside HP_GROWTH.
 */
export function bossAdjusted(damage: number, monster: Monster, alive: number): number {
  if (monster.boss === null) return damage

  const def = BOSS_BY_KEY[monster.boss]
  let out = damage

  if (def.hitCap !== null) out = Math.min(out, monster.maxHp * def.hitCap)
  // "Anything else still circling" — itself excluded, hence > 1.
  if (def.escortedTaken < 1 && alive > 1) out *= def.escortedTaken

  return out
}
