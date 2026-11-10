import type { DamageType, GameState, MonsterSize } from '../core/types'

/**
 * Impact feedback, inferred rather than reported.
 *
 * Nothing here touches `core/`. The renderer keeps what the last frame looked
 * like and diffs against it: a projectile that vanished landed somewhere, a
 * monster whose health dropped was hit, one that disappeared died. That keeps
 * the rule the whole project is built on — the simulator plays the same game
 * the screen shows, because the screen cannot change it — and it means none of
 * this can move the clear rate.
 *
 * The one piece of real design here is the fizzle. A projectile whose target
 * died mid-flight is wasted, and that waste is what makes spreading units
 * around the ring better than stacking them on one arc. It was invisible, so
 * the cost of bad placement was something you could only read about.
 */

const MAX_PARTICLES = 400
/** Impacts decay in game time, so effects speed up with the 2x/3x keys. */
const HIT_LIFE = 0.28
const FIZZLE_LIFE = 0.34
const WAVE_LIFE = 0.42
const SHAKE_DECAY = 7

type Hit = { x: number; y: number; type: DamageType; age: number; power: number }
type Fizzle = { x: number; y: number; age: number }
/** The top-tier line attack sweeping out to the edge of a unit's range. */
type Wave = { x: number; y: number; radius: number; age: number }
type Death = {
  x: number
  y: number
  size: MonsterSize
  boss: boolean
  age: number
  bits: { dx: number; dy: number }[]
}

/**
 * What happened since the last frame, for the audio layer.
 *
 * Counted rather than queued: at 3x with a full ring there are over a thousand
 * shots a second, so nothing downstream can act per event. A tally lets the
 * mixer decide to play one sound for a burst of forty.
 */
export type FxEvents = {
  hits: Record<DamageType, number>
  deaths: number
  bossDeaths: number
  waves: number
}

export type Fx = {
  events: FxEvents
  hits: Hit[]
  fizzles: Fizzle[]
  waves: Wave[]
  deaths: Death[]
  /** Pixels of camera shake left to spend. */
  shake: number
  prevProjectiles: Map<
    number,
    { x: number; y: number; type: DamageType; target: number; rank: number; line: number }
  >
  prevMonsters: Map<number, { x: number; y: number; hp: number; size: MonsterSize; boss: boolean }>
  prevElapsed: number
}

export function createFx(): Fx {
  return {
    events: { hits: { pierce: 0, balanced: 0, blast: 0 }, deaths: 0, bossDeaths: 0, waves: 0 },
    hits: [],
    fizzles: [],
    waves: [],
    deaths: [],
    shake: 0,
    prevProjectiles: new Map(),
    prevMonsters: new Map(),
    prevElapsed: 0,
  }
}

/** Shake is strongest from blast impacts; the others barely nudge. */
const SHAKE_BY_TYPE: Record<DamageType, number> = {
  pierce: 0.05,
  balanced: 0.12,
  blast: 1.1,
}

const SIZE_COLOR: Record<MonsterSize, string> = {
  small: '#7dd3fc',
  medium: '#fbbf24',
  large: '#f87171',
}

export function updateFx(fx: Fx, state: GameState): void {
  const dt = Math.max(0, state.elapsed - fx.prevElapsed)
  fx.prevElapsed = state.elapsed

  const ev = fx.events
  ev.hits.pierce = 0
  ev.hits.balanced = 0
  ev.hits.blast = 0
  ev.deaths = 0
  ev.bossDeaths = 0
  ev.waves = 0

  const monsters = new Map<
    number,
    { x: number; y: number; hp: number; size: MonsterSize; boss: boolean }
  >()
  for (const m of state.monsters) {
    monsters.set(m.id, {
      x: m.pos.x,
      y: m.pos.y,
      hp: m.hp,
      size: m.size,
      boss: m.boss !== null,
    })
  }

  // A projectile that is gone either landed or was wasted on a target that
  // died first. Which one it was is the difference between a spark and a puff.
  const live = new Set(state.projectiles.map((p) => p.id))
  for (const [id, p] of fx.prevProjectiles) {
    if (live.has(id)) continue

    const target = monsters.get(p.target)
    if (target) {
      // Weight by tier, so a Myth landing reads as heavier than a Common one
      // without needing a separate effect per rank.
      const power = 1 + p.rank * 0.22
      fx.hits.push({ x: target.x, y: target.y, type: p.type, age: 0, power })
      fx.shake = Math.min(6, fx.shake + SHAKE_BY_TYPE[p.type] * power)
      ev.hits[p.type]++

      // The line attack washes over the whole arc, so it gets its own ring at
      // the radius it actually reached.
      if (p.line > 0) {
        fx.waves.push({ x: p.x, y: p.y, radius: p.line, age: 0 })
        fx.shake = Math.min(8, fx.shake + 1)
        ev.waves++
      }
    } else {
      fx.fizzles.push({ x: p.x, y: p.y, age: 0 })
    }
  }

  fx.prevProjectiles = new Map(
    state.projectiles.map((p) => [
      p.id,
      {
        x: p.originX,
        y: p.originY,
        type: p.damageType,
        target: p.targetId,
        rank: p.tierRank,
        line: p.lineRadius,
      },
    ]),
  )

  // Monsters that left the list since last frame were killed.
  for (const [id, prev] of fx.prevMonsters) {
    if (monsters.has(id)) continue
    const bits: { dx: number; dy: number }[] = []
    const count = prev.boss ? 16 : prev.size === 'large' ? 10 : 6
    for (let i = 0; i < count; i++) {
      // Spread deterministically off the id, so the same seed bursts the same.
      const a = ((i + id * 7) % count) / count * Math.PI * 2
      const speed = 34 + ((id * 13 + i * 29) % 40)
      bits.push({ dx: Math.cos(a) * speed, dy: Math.sin(a) * speed })
    }
    fx.deaths.push({ x: prev.x, y: prev.y, size: prev.size, boss: prev.boss, age: 0, bits })
    ev.deaths++
    if (prev.boss) {
      fx.shake = Math.min(10, fx.shake + 7)
      ev.bossDeaths++
    }
  }
  fx.prevMonsters = monsters

  age(fx.hits, dt, HIT_LIFE)
  age(fx.fizzles, dt, FIZZLE_LIFE)
  age(fx.waves, dt, WAVE_LIFE)
  age(fx.deaths, dt, 0.5)
  fx.shake = Math.max(0, fx.shake - fx.shake * SHAKE_DECAY * dt - 0.05 * dt * 60)

  // Under a hail of Archer fire this list grows faster than it drains; drop the
  // oldest rather than let a long run accumulate thousands of sparks.
  trim(fx.hits)
  trim(fx.fizzles)
  trim(fx.waves)
  trim(fx.deaths)
}

function age<T extends { age: number }>(list: T[], dt: number, life: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].age += dt
    if (list[i].age >= life) list.splice(i, 1)
  }
}

function trim(list: unknown[]): void {
  if (list.length > MAX_PARTICLES) list.splice(0, list.length - MAX_PARTICLES)
}

/** Camera offset for this frame. Deterministic in elapsed, so replays match. */
export function shakeOffset(fx: Fx, elapsed: number): { x: number; y: number } {
  if (fx.shake < 0.1) return { x: 0, y: 0 }
  return {
    x: Math.sin(elapsed * 61) * fx.shake,
    y: Math.cos(elapsed * 47) * fx.shake,
  }
}

export function drawFx(ctx: CanvasRenderingContext2D, fx: Fx): void {
  for (const h of fx.hits) {
    const t = h.age / HIT_LIFE
    const fade = 1 - t

    if (h.type === 'blast') {
      // A shockwave ring, because the Mage's damage reaches past what it hit.
      ctx.strokeStyle = `rgba(196, 181, 253, ${(fade * 0.8).toFixed(3)})`
      ctx.lineWidth = (3 * fade + 0.5) * h.power
      ctx.beginPath()
      ctx.arc(h.x, h.y, (6 + t * 42) * h.power, 0, Math.PI * 2)
      ctx.stroke()

      ctx.fillStyle = `rgba(237, 233, 254, ${(fade * 0.5).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(h.x, h.y, 10 * fade * h.power, 0, Math.PI * 2)
      ctx.fill()
      continue
    }

    // Pierce and balanced: a short bright flash on the body.
    const r = (h.type === 'pierce' ? 5 : 8) * (1 - t * 0.5) * h.power
    ctx.fillStyle = `rgba(255, 255, 255, ${(fade * 0.85).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Wasted shots: a grey puff, deliberately drab. It should read as nothing
  // happening, because nothing did.
  for (const f of fx.fizzles) {
    const t = f.age / FIZZLE_LIFE
    ctx.strokeStyle = `rgba(139, 152, 173, ${((1 - t) * 0.5).toFixed(3)})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(f.x, f.y, 2 + t * 7, 0, Math.PI * 2)
    ctx.stroke()
  }

  // The line sweep: a thin ring racing out to the unit's full range.
  for (const w of fx.waves) {
    const t = w.age / WAVE_LIFE
    const fade = 1 - t
    ctx.strokeStyle = `rgba(248, 250, 255, ${(fade * 0.5).toFixed(3)})`
    ctx.lineWidth = 2 * fade + 0.4
    ctx.beginPath()
    ctx.arc(w.x, w.y, w.radius * Math.sqrt(t), 0, Math.PI * 2)
    ctx.stroke()
  }

  for (const d of fx.deaths) {
    const t = Math.min(1, d.age / 0.5)
    const fade = 1 - t
    ctx.fillStyle = d.boss ? '#ffffff' : SIZE_COLOR[d.size]
    ctx.globalAlpha = fade
    const r = (d.boss ? 3.5 : 2.2) * fade
    for (const b of d.bits) {
      ctx.beginPath()
      ctx.arc(d.x + b.dx * t, d.y + b.dy * t, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}
