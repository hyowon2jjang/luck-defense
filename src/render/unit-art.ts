import { TIER_BY_KEY, TIER_ORDER } from '../core/data/tiers'
import type { ClassId, TierKey } from '../core/types'

/**
 * Unit tiles: a little figure on a coloured pad, throwing something.
 *
 * The constraint is harsher than the bosses': a unit is 36 pixels and there can
 * be sixty-one at once. Whatever is drawn has to survive being repeated sixty
 * times without turning the board into noise.
 *
 *   colour   the TIER, and nothing else — pad, frame and glow all say rank
 *   shape    the CLASS, and nothing else — weapon, hat and stance
 *
 * Both readings used to be colours, and three of the eight tier colours are the
 * exact hex of the three class colours: Rare is the Archer's green, Ancient the
 * Ninja's blue, Primal the Mage's purple. On those pairings the tile collapsed
 * into one flat lozenge and lost both readings at once.
 *
 * Splitting them by KIND rather than by hue fixes every pairing permanently,
 * and hands the whole 32px field to the question a full board actually has to
 * answer: where is my Legend among sixty Commons.
 *
 * The figure is therefore neutral, in a value ladder that survives any pad:
 * body darkest, hat mid, weapon brightest.
 */
const BODY = '#131a28'
const HAT = '#aab6c8'
const STEEL = '#e8eff9'

/** Tiers at or above this get an outer glow, strengthening with rank. */
const GLOW_FROM = TIER_ORDER.indexOf('epic')
/**
 * Seconds the release pose is held after a shot.
 *
 * The same figure then reads differently per class without a single per-class
 * number: an Archer fires every 0.18s, so it is permanently mid-throw, while a
 * Mage at 2.4s winds up slowly and snaps. The animation inherits the balance.
 */
const RELEASE = 0.12

export function drawUnitBody(
  ctx: CanvasRenderingContext2D,
  classId: ClassId,
  tier: TierKey,
  x: number,
  y: number,
  size: number,
  elapsed: number,
  active: boolean,
  /** Radians toward what it is shooting at. */
  facing = 0,
  /** Seconds since its last shot, and the gap between shots. */
  sinceFire = 0,
  interval = 1,
): void {
  const tierDef = TIER_BY_KEY[tier]
  const rank = TIER_ORDER.indexOf(tier)

  ctx.save()

  // Top tiers burn. Slow pulse and a capped radius: sixty flashing tiles would
  // be worse than no signal at all.
  if (rank >= GLOW_FROM) {
    const strength = (rank - GLOW_FROM + 1) / (TIER_ORDER.length - GLOW_FROM)
    ctx.shadowColor = tierDef.color
    ctx.shadowBlur = 4 + strength * 7 * (0.8 + 0.2 * Math.sin(elapsed * 2.4 + rank))
  }

  // The pad carries the tier: the biggest surface on the tile, given to the
  // thing a crowded board is scanned for. Deepened so the neutral figure and
  // the full-strength frame both stay legible on top of it.
  const pad = ctx.createLinearGradient(x, y, x, y + size)
  pad.addColorStop(0, shade(tierDef.color, 0.5))
  pad.addColorStop(1, shade(tierDef.color, 0.26))
  roundRect(ctx, x, y, size, size, size * 0.17)
  ctx.fillStyle = pad
  ctx.fill()

  ctx.shadowBlur = 0

  ctx.strokeStyle = tierDef.color
  ctx.lineWidth = active ? 3 : 1.6 + rank * 0.17
  ctx.stroke()

  // Clipped to the pad so a projectile leaves the tile by vanishing at the
  // edge rather than drawing over the neighbour.
  ctx.save()
  roundRect(ctx, x, y, size, size, size * 0.17)
  ctx.clip()
  figure(ctx, classId, x, y, size, facing, sinceFire, interval)
  ctx.restore()

  ctx.restore()
}

/**
 * One thrower, seen from above.
 *
 * The camera looks straight down — the track is a circle on the ground, not a
 * horizon — so a standing side-view figure was simply the wrong projection. From
 * here you see a hat, the shoulders under it, and the arms. That turns out to
 * suit the game: the hat is the biggest shape on the tile, so colouring it by
 * tier makes rank the thing you read first on a crowded board.
 *
 * Drawn facing +x in a space centred on the tile, then rotated, so every shape
 * below is written once for a unit looking right.
 *
 * The throw is driven by the unit's actual cooldown rather than a free-running
 * loop. A tile that mimed throwing on its own schedule was animation played
 * next to the game instead of animation of it — arms swinging while nothing
 * fired, and shots leaving while the arm was still drawn back.
 */
function figure(
  ctx: CanvasRenderingContext2D,
  classId: ClassId,
  x: number,
  y: number,
  size: number,
  facing: number,
  sinceFire: number,
  interval: number,
): void {
  const ink = BODY

  // Release decays right after a shot; wind-up builds toward the next one. An
  // idle unit holds at full wind-up, which reads as ready rather than frozen.
  const release = Math.max(0, 1 - sinceFire / RELEASE)
  const windup = Math.min(1, sinceFire / Math.max(interval, 0.0001))

  ctx.save()
  ctx.translate(x + size / 2, y + size / 2)
  ctx.rotate(facing)

  const u = (n: number) => n * size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Shoulders: broader across the body than along it, which is what tells the
  // eye this is a figure seen from above rather than a blob.
  ctx.fillStyle = ink
  ctx.beginPath()
  ctx.ellipse(u(-0.04), 0, u(0.15), u(0.28), 0, 0, Math.PI * 2)
  ctx.fill()

  // Arms. The throwing arm draws back as the cooldown runs down, then snaps
  // out on the frame the shot actually leaves.
  const reach = 0.16 - 0.06 * windup + 0.18 * release
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(1.3, u(0.07))
  ctx.beginPath()
  ctx.moveTo(u(0.02), u(-0.15))
  ctx.lineTo(u(reach), u(-0.12 + 0.05 * windup - 0.03 * release))
  ctx.moveTo(u(0.02), u(0.15))
  ctx.lineTo(u(0.16), u(0.13))
  ctx.stroke()

  hat(ctx, classId, u)

  // Last, so it sits over the hat brim rather than under it — and the hand is
  // pushed clear of the brim, which is wide enough on a Mage to swallow it.
  //
  // This is the one class signal that owes nothing to colour. The other two are
  // hues, and three of the eight tier colours are the exact hex of the three
  // class colours, so on those pairings hue tells you nothing at all.
  weapon(ctx, classId, u, Math.max(reach, 0.3), -0.12 + 0.05 * windup - 0.03 * release)
  ctx.restore()
}

/**
 * What the unit is holding, inked dark in its forward hand.
 *
 * Each one breaks the round silhouette in a different direction — the bow
 * across it, the staff along it, the shuriken as a star — which is what makes
 * them tell apart at a glance rather than on inspection.
 */
function weapon(
  ctx: CanvasRenderingContext2D,
  classId: ClassId,
  u: (n: number) => number,
  hx: number,
  hy: number,
): void {
  // Light rather than ink. The body is dark and the pad is now a deep field, so
  // a dark weapon disappears into both; a pale one separates from everything.
  ctx.save()
  ctx.shadowColor = '#0a0d14'
  ctx.shadowBlur = Math.max(2, u(0.1))
  ctx.strokeStyle = STEEL
  ctx.fillStyle = STEEL

  if (classId === 'archer') {
    // A bow held across the line of fire: a tall arc, the widest shape here.
    ctx.lineWidth = Math.max(1.2, u(0.055))
    ctx.beginPath()
    ctx.arc(u(hx - 0.06), u(hy), u(0.2), -Math.PI * 0.42, Math.PI * 0.42)
    ctx.stroke()

    ctx.lineWidth = Math.max(0.8, u(0.025))
    ctx.beginPath()
    ctx.moveTo(u(hx + 0.02), u(hy - 0.18))
    ctx.lineTo(u(hx + 0.02), u(hy + 0.18))
    ctx.stroke()
    ctx.restore()
    return
  }

  if (classId === 'mage') {
    // A staff along the line of fire, with the orb out at the tip.
    ctx.lineWidth = Math.max(1.2, u(0.055))
    ctx.beginPath()
    ctx.moveTo(u(hx - 0.14), u(hy + 0.1))
    ctx.lineTo(u(hx + 0.12), u(hy - 0.08))
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(u(hx + 0.15), u(hy - 0.1), u(0.07), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }

  // Ninja: the shuriken itself, already in hand.
  const outer = u(0.11)
  const inner = u(0.038)
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const r = i % 2 === 0 ? outer : inner
    const sx = u(hx) + Math.cos(a) * r
    const sy = u(hy) + Math.sin(a) * r
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.closePath()
  ctx.fill()
}

/**
 * Hats from above. Shape alone — the colour here is neutral by design.
 *
 * Seen from directly above, a hat is mostly a disc — so each one needs a second
 * feature that breaks the circle, or all three classes look identical.
 */
function hat(
  ctx: CanvasRenderingContext2D,
  classId: ClassId,
  u: (n: number) => number,
): void {
  // Mid-grey, between the near-black body and the bright weapon. A dark bloom
  // under it keeps the edge against a pale pad such as Common's.
  const color = HAT
  ctx.save()
  ctx.shadowColor = '#0a0d14'
  ctx.shadowBlur = Math.max(2, u(0.09))
  ctx.fillStyle = color
  ctx.strokeStyle = color

  if (classId === 'archer') {
    // Peaked cap: a round crown with the peak jutting forward over the brow.
    ctx.beginPath()
    ctx.moveTo(u(0.3), 0)
    ctx.quadraticCurveTo(u(0.22), u(-0.12), u(0.08), u(-0.13))
    ctx.quadraticCurveTo(u(0.22), u(0.12), u(0.3), 0)
    ctx.fill()

    ctx.beginPath()
    ctx.arc(0, 0, u(0.17), 0, Math.PI * 2)
    ctx.fill()

    // Feather, swept back past the shoulder.
    ctx.lineWidth = Math.max(1.1, u(0.05))
    ctx.beginPath()
    ctx.moveTo(u(-0.1), u(-0.12))
    ctx.lineTo(u(-0.32), u(-0.26))
    ctx.stroke()
    ctx.restore()
    return
  }

  if (classId === 'mage') {
    // Wide brim with the cone's tip as a small disc at the centre — the only
    // way a pointed hat reads as pointed when you are looking down the point.
    ctx.beginPath()
    ctx.ellipse(u(-0.02), 0, u(0.24), u(0.21), 0, 0, Math.PI * 2)
    ctx.fill()

    // The tip of the cone, lifted off the brim by a thin dark ring so it does
    // not merge into one flat disc.
    ctx.fillStyle = '#131a28'
    ctx.beginPath()
    ctx.arc(u(0.02), 0, u(0.1), 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(u(0.02), 0, u(0.07), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }

  // Ninja: a hood with the headband tie streaming behind.
  ctx.beginPath()
  ctx.arc(0, 0, u(0.16), 0, Math.PI * 2)
  ctx.fill()

  ctx.lineWidth = Math.max(1.2, u(0.065))
  ctx.beginPath()
  ctx.moveTo(u(0.04), u(-0.17))
  ctx.lineTo(u(0.04), u(0.17))
  ctx.stroke()

  ctx.lineWidth = Math.max(1, u(0.045))
  ctx.beginPath()
  ctx.moveTo(u(-0.12), u(-0.08))
  ctx.lineTo(u(-0.33), u(-0.2))
  ctx.moveTo(u(-0.12), u(0.02))
  ctx.lineTo(u(-0.33), u(-0.04))
  ctx.stroke()
  ctx.restore()
}

/** Darkens a #rrggbb colour toward black by `factor`. */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * factor)
  const g = Math.round(((n >> 8) & 255) * factor)
  const b = Math.round((n & 255) * factor)
  return `rgb(${r}, ${g}, ${b})`
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
