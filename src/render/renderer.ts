import { CLASSES } from '../core/data/classes'
import {
  CELL,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  INNER_LIMIT,
  TRACK_CENTER,
  TRACK_RADIUS,
  TRACK_WIDTH,
  anchorRect,
  angleOf,
  canPlace,
  coverage,
  radiusOf,
  unitCenter,
} from '../core/data/board'
import { BOSS_BY_KEY } from '../core/data/bosses'
import { createFx, drawFx, shakeOffset, updateFx } from './effects'
import type { Fx } from './effects'
import { drawBossBody } from './boss-art'
import { drawUnitBody } from './unit-art'
import { attackInterval } from '../core/systems/combat'
import { TIER_BY_KEY } from '../core/data/tiers'
import { TRACK_CAUTION, TRACK_LIMIT, TRACK_WARN } from '../core/data/waves'
import type { GameState, Monster, MonsterSize, Unit } from '../core/types'

const SIZE_RADIUS: Record<MonsterSize, number> = { small: 7, medium: 10, large: 15 }
const BOSS_RADIUS = 22
/** A boss that rotates its size has to look like the size it currently is. */
const BOSS_SIZE_RADIUS: Record<MonsterSize, number> = { small: 13, medium: 17, large: 22 }
const SIZE_COLOR: Record<MonsterSize, string> = {
  small: '#7dd3fc',
  medium: '#fbbf24',
  large: '#f87171',
}

/** Interaction state owned by the UI. The renderer only reads it. */
export type ViewState = {
  /** Unit being hovered, dragged, or waiting to be placed from the bench. */
  activeUnitId: number | null
  /** Anchor the active unit would take, centred on the cursor. */
  hoverAnchor: number | null
  dragging: boolean
  /** Units belonging to a roster group the player has selected. */
  highlight: ReadonlySet<number>
}

export const EMPTY_VIEW: ViewState = {
  activeUnitId: null,
  hoverAnchor: null,
  dragging: false,
  highlight: new Set(),
}

/**
 * Draws a GameState. Pure output: this must never mutate state, so the same
 * state always produces the same frame.
 */
export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState = EMPTY_VIEW,
  /** Impact state, owned by the caller so it survives between frames. */
  fx: Fx = createFx(),
): void {
  updateFx(fx, state)

  ctx.fillStyle = '#0f1420'
  ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT)

  const active =
    view.activeUnitId === null
      ? null
      : state.units.find((u) => u.id === view.activeUnitId) ?? null

  // --- Still layer: everything the pointer talks to -----------------------
  //
  // Hit testing (`unitAtPoint`) works from grid anchors, which no camera shake
  // moves. Drawing these shaken would put a unit up to fourteen pixels — a
  // third of a tile — away from where clicking it actually lands, and the
  // mismatch grows through a run as impacts get more frequent. So the board
  // the player manipulates does not move; only what is being hit does.
  drawTrack(ctx, state)

  // Placement aids only appear while something is actually being moved. A
  // selected unit is described in the panel instead of cluttering the field.
  const moving = active !== null && (view.dragging || view.hoverAnchor !== null)
  if (moving) {
    drawBuildArea(ctx)
    drawReach(ctx, view, active)
  }
  drawUnits(ctx, state, active, view.highlight)
  if (moving) drawGhost(ctx, state, view, active)

  // --- Shaken layer: monsters, shots and impacts --------------------------
  const shake = shakeOffset(fx, state.elapsed)
  ctx.save()
  ctx.translate(shake.x, shake.y)
  drawProjectiles(ctx, state)
  drawMonsters(ctx, state)
  drawFx(ctx, fx)
  ctx.restore()
}

function drawTrack(ctx: CanvasRenderingContext2D, state: GameState): void {
  const count = state.monsters.length
  const warning = count > TRACK_WARN
  const caution = count > TRACK_CAUTION

  ctx.strokeStyle = '#1b2436'
  ctx.lineWidth = TRACK_WIDTH
  ctx.beginPath()
  ctx.arc(TRACK_CENTER.x, TRACK_CENTER.y, TRACK_RADIUS, 0, Math.PI * 2)
  ctx.stroke()

  // Two steps, and they differ in kind rather than just hue. Amber holds
  // steady — something to notice. Red pulses, and faster the closer it gets.
  if (warning) {
    const urgency = (count - TRACK_WARN) / (TRACK_LIMIT - TRACK_WARN)
    const rate = 6 + urgency * 8
    const pulse = 0.35 + 0.25 * Math.sin(state.elapsed * rate)
    ctx.strokeStyle = `rgba(248, 113, 113, ${pulse.toFixed(3)})`
    ctx.lineWidth = TRACK_WIDTH
    ctx.stroke()
  } else if (caution) {
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.16)'
    ctx.lineWidth = TRACK_WIDTH
    ctx.stroke()
  }

  ctx.strokeStyle = warning ? '#5c2b34' : caution ? '#5c4a1f' : '#2a3550'
  ctx.lineWidth = 2
  ctx.setLineDash([9, 13])
  ctx.stroke()
  ctx.setLineDash([])
}

/** The buildable disc. Nothing may be placed outside the ring. */
function drawBuildArea(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#ffffff06'
  ctx.beginPath()
  ctx.arc(TRACK_CENTER.x, TRACK_CENTER.y, INNER_LIMIT, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#3a4867'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 4])
  ctx.stroke()
  ctx.setLineDash([])
}

/**
 * The arc of track this unit actually reaches from where it would stand.
 *
 * Deliberately not a range circle: the circle is geometry the player has to
 * intersect in their head, while the arc is the answer — how much of the lap
 * this unit gets to shoot at.
 */
function drawReach(ctx: CanvasRenderingContext2D, view: ViewState, active: Unit): void {
  const anchor = previewAnchor(view, active)
  if (anchor === null) return

  const def = CLASSES[active.classId]
  const origin = unitCenter(anchor, def.footprint)
  const reach = coverage(radiusOf(anchor, def.footprint), def.range)
  if (reach <= 0) return

  const mid = Math.atan2(origin.y - TRACK_CENTER.y, origin.x - TRACK_CENTER.x)
  const half = reach * Math.PI

  ctx.strokeStyle = def.color
  ctx.lineWidth = TRACK_WIDTH - 10
  ctx.beginPath()
  ctx.arc(TRACK_CENTER.x, TRACK_CENTER.y, TRACK_RADIUS, mid - half, mid + half)
  ctx.stroke()

  ctx.strokeStyle = def.color + '44'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(origin.x, origin.y)
  ctx.lineTo(
    TRACK_CENTER.x + Math.cos(mid) * TRACK_RADIUS,
    TRACK_CENTER.y + Math.sin(mid) * TRACK_RADIUS,
  )
  ctx.stroke()
}

/** Footprint preview under the cursor, coloured by whether it can go there. */
function drawGhost(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: ViewState,
  active: Unit,
): void {
  if (view.hoverAnchor === null) return

  const size = CLASSES[active.classId].footprint
  const legal = canPlace(view.hoverAnchor, size)
  const r = anchorRect(view.hoverAnchor, size)

  const displaces =
    legal &&
    state.units.some(
      (u) =>
        u.cell !== null &&
        u.id !== active.id &&
        overlaps(u, view.hoverAnchor as number, size),
    )

  const color = !legal ? '#f87171' : displaces ? '#fbbf24' : '#4ade80'
  ctx.fillStyle = color + '22'
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.fillRect(r.x, r.y, r.side, r.side)
  ctx.strokeRect(r.x + 1, r.y + 1, r.side - 2, r.side - 2)

  // Cell ticks, so the footprint size is readable at a glance.
  ctx.strokeStyle = color + '33'
  ctx.lineWidth = 1
  for (let i = 1; i < size; i++) {
    ctx.beginPath()
    ctx.moveTo(r.x + i * CELL, r.y)
    ctx.lineTo(r.x + i * CELL, r.y + r.side)
    ctx.moveTo(r.x, r.y + i * CELL)
    ctx.lineTo(r.x + r.side, r.y + i * CELL)
    ctx.stroke()
  }
}

function overlaps(unit: Unit, anchor: number, size: number): boolean {
  if (unit.cell === null) return false
  const a = anchorRect(unit.cell, CLASSES[unit.classId].footprint)
  const b = anchorRect(anchor, size)
  return (
    a.x < b.x + b.side && a.x + a.side > b.x && a.y < b.y + b.side && a.y + a.side > b.y
  )
}

/** Where the active unit would end up: the hovered anchor, else where it stands. */
function previewAnchor(view: ViewState, active: Unit): number | null {
  const size = CLASSES[active.classId].footprint
  if (view.hoverAnchor !== null && canPlace(view.hoverAnchor, size)) return view.hoverAnchor
  return active.cell
}

function drawUnits(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  active: Unit | null,
  highlight: ReadonlySet<number>,
): void {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const unit of state.units) {
    if (unit.cell === null) continue

    const def = CLASSES[unit.classId]
    const r = anchorRect(unit.cell, def.footprint)
    const tier = TIER_BY_KEY[unit.tier]
    const isActive = active !== null && active.id === unit.id
    const pad = 2
    const radius = 5

    // Roster group selection: show every member at once, so a bulk sell is
    // never a blind one.
    if (highlight.has(unit.id)) {
      ctx.strokeStyle = tier.color
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 3])
      roundRect(ctx, r.x - 3, r.y - 3, r.side + 6, r.side + 6, radius + 3)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Auto-placement avoids the slots a class cannot fire from, but a player
    // can still drag one there by hand. The range ring shows it if you look;
    // this says it without looking, because a unit that never fires is the
    // kind of mistake you only notice from the kill counts much later.
    if (coverage(radiusOf(unit.cell, def.footprint), def.range) <= 0) {
      ctx.strokeStyle = '#f87171'
      ctx.lineWidth = 1.5
      ctx.setLineDash([2, 3])
      roundRect(ctx, r.x - 2, r.y - 2, r.side + 4, r.side + 4, 7)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = '#f87171'
      ctx.font = 'bold 11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('!', r.x + r.side - 3, r.y + 4)
    }

    drawUnitBody(
      ctx,
      unit.classId,
      unit.tier,
      r.x + pad,
      r.y + pad,
      r.side - pad * 2,
      state.elapsed,
      isActive,
      // Aimed at what it last shot. Before the first shot there is nothing to
      // aim at, so it watches the track — everything arrives from out there.
      unit.facing ?? angleOf(unit.cell, def.footprint),
      // Cooldown counts down from the interval, so this is time since firing.
      // Read from the same helper combat uses, tier bonus included — which is
      // what makes a promoted unit visibly throw faster.
      attackInterval(unit) - unit.cooldown,
      attackInterval(unit),
    )
  }
}

function roundRect(
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

/**
 * Projectiles, drawn as the thing each class actually throws.
 *
 * They were all identical dots. The unit tiles already show an Archer holding a
 * bow and a Ninja a shuriken, so what left their hands should match — and the
 * three have genuinely different behaviour worth reading in flight: the arrow
 * is the fastest, the shuriken spins, the Mage's bolt is slow and heavy, which
 * is exactly why it wastes the most shots.
 *
 * Orientation comes from the vector to the target, which is the direction of
 * travel: the projectile homes, so that is where it is going next.
 */
function drawProjectiles(ctx: CanvasRenderingContext2D, state: GameState): void {
  const monsters = new Map(state.monsters.map((m) => [m.id, m]))

  for (const p of state.projectiles) {
    const target = monsters.get(p.targetId)
    const angle = target
      ? Math.atan2(target.pos.y - p.y, target.pos.x - p.x)
      : // Target already dead: this shot is wasted and about to vanish. Let it
        // coast on its last heading rather than snapping to a default.
        0

    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(angle)
    // A Myth shot should look like one in flight, not only on impact.
    if (p.tierRank > 0) {
      const grow = 1 + p.tierRank * 0.11
      ctx.scale(grow, grow)
    }

    if (p.damageType === 'pierce') {
      // An arrow: a lit streak with a head, long enough to read as motion.
      ctx.strokeStyle = '#f8fbff'
      ctx.lineWidth = 1.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-9, 0)
      ctx.lineTo(3, 0)
      ctx.stroke()

      ctx.strokeStyle = '#7dd3fc88'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(-16, 0)
      ctx.lineTo(-8, 0)
      ctx.stroke()

      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.moveTo(6, 0)
      ctx.lineTo(1, -2.4)
      ctx.lineTo(1, 2.4)
      ctx.closePath()
      ctx.fill()
    } else if (p.damageType === 'blast') {
      // A heavy bolt: a hot core inside a soft halo, with a short smear behind.
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 9)
      glow.addColorStop(0, '#ede9feee')
      glow.addColorStop(0.45, '#a78bfa88')
      glow.addColorStop(1, '#a78bfa00')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(0, 0, 9, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = '#f5f3ff'
      ctx.beginPath()
      ctx.arc(0, 0, 2.6, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = '#c4b5fd55'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-11, 0)
      ctx.lineTo(-3, 0)
      ctx.stroke()
    } else {
      // A shuriken, spinning. Driven by elapsed time so it keeps turning at
      // whatever speed the game is being watched at.
      ctx.rotate(state.elapsed * 15)
      ctx.fillStyle = '#e8eff9'
      ctx.beginPath()
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const r = i % 2 === 0 ? 4.6 : 1.6
        const x = Math.cos(a) * r
        const y = Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fill()
    }

    ctx.restore()
  }
}

function drawMonsters(ctx: CanvasRenderingContext2D, state: GameState): void {
  // Bosses last so a boss is never hidden under the trash it arrived with.
  for (const m of state.monsters) if (m.boss === null) drawTrash(ctx, m)

  let alive = 0
  for (const m of state.monsters) if (m.hp > 0) alive++

  for (const m of state.monsters) if (m.boss !== null) drawBoss(ctx, state, m, alive)
}

function drawTrash(ctx: CanvasRenderingContext2D, m: Monster): void {
  const r = SIZE_RADIUS[m.size]

  ctx.fillStyle = SIZE_COLOR[m.size]
  ctx.beginPath()
  ctx.arc(m.pos.x, m.pos.y, r, 0, Math.PI * 2)
  ctx.fill()

  drawHealthBar(ctx, m, r)
}

/**
 * A boss reads as a boss, and its trait reads off the sprite.
 *
 * The HUD already spells the trait out in words; this is the second channel, so
 * a player watching the field rather than the panel still sees why their damage
 * is going nowhere.
 */
function drawBoss(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  m: Monster,
  alive: number,
): void {
  const def = BOSS_BY_KEY[m.boss!]
  const r = def.cycle ? BOSS_SIZE_RADIUS[m.size] : BOSS_RADIUS

  // A glow under the body, so a dark silhouette separates from the dark track
  // and the colour the HUD banner uses still means something on the field.
  const glow = ctx.createRadialGradient(m.pos.x, m.pos.y, 0, m.pos.x, m.pos.y, r * 1.9)
  glow.addColorStop(0, `${def.color}44`)
  glow.addColorStop(1, `${def.color}00`)
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(m.pos.x, m.pos.y, r * 1.9, 0, Math.PI * 2)
  ctx.fill()

  // Each silhouette reaches a different distance, so it reports its own extent
  // and everything below frames the art rather than the radius it was given.
  const extent = drawBossBody(ctx, m.boss!, def.color, m.pos.x, m.pos.y, r, state.elapsed, m.size)

  // Shielded: a solid outer ring, on only while the shield is actually up.
  if (def.escortedTaken < 1 && alive > 1) {
    const pulse = 0.5 + 0.3 * Math.sin(state.elapsed * 4)
    ctx.strokeStyle = `rgba(226, 232, 240, ${pulse.toFixed(3)})`
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(m.pos.x, m.pos.y, extent + 6, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Regenerating: a dashed ring that turns with the healing.
  if (def.regen > 0 && m.hp < m.maxHp) {
    ctx.strokeStyle = '#4ade8099'
    ctx.lineWidth = 3
    ctx.setLineDash([5, 6])
    ctx.lineDashOffset = -state.elapsed * 22
    ctx.beginPath()
    ctx.arc(m.pos.x, m.pos.y, extent + 6, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.lineDashOffset = 0
  }

  // Capped: notches around the rim, one per blow it will accept.
  if (def.hitCap !== null) {
    const notches = Math.min(24, Math.round(1 / def.hitCap))
    ctx.strokeStyle = '#e2e8f066'
    ctx.lineWidth = 2
    for (let i = 0; i < notches; i++) {
      const a = (i / notches) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(
        m.pos.x + Math.cos(a) * (extent + 3),
        m.pos.y + Math.sin(a) * (extent + 3),
      )
      ctx.lineTo(
        m.pos.x + Math.cos(a) * (extent + 7),
        m.pos.y + Math.sin(a) * (extent + 7),
      )
      ctx.stroke()
    }
  }

  drawHealthBar(ctx, m, extent)

  ctx.fillStyle = '#e2e8f0'
  ctx.font = 'bold 11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // The current size is the Shifter's whole fight, so it is named, not implied.
  ctx.fillText(
    def.cycle ? `${def.name} · ${m.size}` : def.name,
    m.pos.x,
    m.pos.y + extent + 14,
  )
}

function drawHealthBar(ctx: CanvasRenderingContext2D, m: Monster, r: number): void {
  if (m.hp >= m.maxHp) return

  const w = r * 2.4
  ctx.fillStyle = '#00000099'
  ctx.fillRect(m.pos.x - w / 2, m.pos.y - r - 7, w, 3)
  ctx.fillStyle = '#4ade80'
  ctx.fillRect(m.pos.x - w / 2, m.pos.y - r - 7, w * (m.hp / m.maxHp), 3)
}
