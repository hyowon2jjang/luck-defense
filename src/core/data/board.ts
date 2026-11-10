import type { Vec2 } from '../types'

/**
 * The field is square because the arena is a circle.
 *
 * It was 960x540, which left two large empty wedges either side of the ring and
 * forced the whole page wider than a screen. A square frames the track with an
 * even margin and gives the width back to the panels, which is what let the
 * whole HUD fit without scrolling.
 */
export const FIELD_WIDTH = 520
export const FIELD_HEIGHT = 520

/**
 * The track is a circle, not a path with an exit.
 *
 * This is what makes the carryover rule work: a monster you fail to kill does
 * not leave the map, it comes back around. Pressure accumulates until the
 * track is full and the run ends.
 */
export const TRACK_CENTER: Vec2 = { x: 260, y: 260 }
export const TRACK_RADIUS = 200
export const TRACK_LENGTH = 2 * Math.PI * TRACK_RADIUS
/** Visual width of the track; also the keep-out margin for placement. */
export const TRACK_WIDTH = 36

/**
 * Units may only stand INSIDE the ring. Everything outside is off limits, so
 * the interior disc is the entire floor-space budget for the run.
 */
export const INNER_LIMIT = TRACK_RADIUS - TRACK_WIDTH / 2

/** Position at `distance` pixels along the track, wrapping every lap. */
export function trackAt(distance: number): Vec2 {
  const angle = (distance / TRACK_RADIUS) % (Math.PI * 2)
  return {
    x: TRACK_CENTER.x + Math.cos(angle) * TRACK_RADIUS,
    y: TRACK_CENTER.y + Math.sin(angle) * TRACK_RADIUS,
  }
}

// --- Placement grid -------------------------------------------------------

export const CELL = 18
// Just large enough to contain the buildable disc; the ring's outer edge sits
// at 218 from the centre, so the grid only has to cover the inner 182.
export const GRID_COLS = 28
export const GRID_ROWS = 28
const ORIGIN_X = (FIELD_WIDTH - GRID_COLS * CELL) / 2
const ORIGIN_Y = (FIELD_HEIGHT - GRID_ROWS * CELL) / 2

export const CELL_COUNT = GRID_COLS * GRID_ROWS

/**
 * A unit is anchored at the top-left cell of its footprint square. The grid is
 * fine (18px) so that 2x2 / 3x3 / 4x4 units can be packed tightly rather than
 * each wasting a coarse cell.
 */
export function anchorRect(anchor: number, size: number) {
  const col = anchor % GRID_COLS
  const row = Math.floor(anchor / GRID_COLS)
  const side = size * CELL
  return { x: ORIGIN_X + col * CELL, y: ORIGIN_Y + row * CELL, side }
}

export function unitCenter(anchor: number, size: number): Vec2 {
  const r = anchorRect(anchor, size)
  return { x: r.x + r.side / 2, y: r.y + r.side / 2 }
}

/** Anchor that centres a `size` footprint on a point, or null if off-grid. */
export function anchorAt(x: number, y: number, size: number): number | null {
  const col = Math.round((x - ORIGIN_X - (size * CELL) / 2) / CELL)
  const row = Math.round((y - ORIGIN_Y - (size * CELL) / 2) / CELL)
  if (col < 0 || row < 0 || col + size > GRID_COLS || row + size > GRID_ROWS) return null
  return row * GRID_COLS + col
}

/** Every cell a unit occupies, for overlap tests. */
export function footprintCells(anchor: number, size: number): number[] {
  const col = anchor % GRID_COLS
  const row = Math.floor(anchor / GRID_COLS)
  const out: number[] = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) out.push((row + r) * GRID_COLS + col + c)
  }
  return out
}

/** The whole footprint must fit inside the ring — corners included. */
export function canPlace(anchor: number, size: number): boolean {
  const col = anchor % GRID_COLS
  const row = Math.floor(anchor / GRID_COLS)
  if (col < 0 || row < 0 || col + size > GRID_COLS || row + size > GRID_ROWS) return false

  const { x, y, side } = anchorRect(anchor, size)
  const limitSq = INNER_LIMIT * INNER_LIMIT
  for (const [px, py] of [
    [x, y],
    [x + side, y],
    [x, y + side],
    [x + side, y + side],
  ]) {
    const dx = px - TRACK_CENTER.x
    const dy = py - TRACK_CENTER.y
    if (dx * dx + dy * dy > limitSq) return false
  }
  return true
}

const ANCHOR_CACHE = new Map<number, readonly number[]>()

/** Every legal anchor for a given footprint size. */
export function placeableAnchors(size: number): readonly number[] {
  const cached = ANCHOR_CACHE.get(size)
  if (cached) return cached

  const out: number[] = []
  for (let i = 0; i < CELL_COUNT; i++) if (canPlace(i, size)) out.push(i)
  ANCHOR_CACHE.set(size, out)
  return out
}

/** Rough capacity if the interior were filled with one footprint size. */
export function capacityFor(size: number): number {
  const area = Math.PI * INNER_LIMIT * INNER_LIMIT
  return Math.floor(area / Math.pow(size * CELL, 2))
}

/**
 * Fraction of the track a unit at distance `p` from the centre can reach.
 *
 * Longer range wants to sit deeper inside the circle, so the three classes
 * naturally settle into three concentric bands. No rule enforces this — it
 * falls out of the geometry.
 */
export function coverage(p: number, range: number): number {
  if (p === 0) return range >= TRACK_RADIUS ? 1 : 0
  const cos =
    (p * p + TRACK_RADIUS * TRACK_RADIUS - range * range) / (2 * p * TRACK_RADIUS)
  if (cos <= -1) return 1
  if (cos >= 1) return 0
  return Math.acos(cos) / Math.PI
}

export function radiusOf(anchor: number, size: number): number {
  const c = unitCenter(anchor, size)
  return Math.hypot(c.x - TRACK_CENTER.x, c.y - TRACK_CENTER.y)
}

export function angleOf(anchor: number, size: number): number {
  const c = unitCenter(anchor, size)
  return Math.atan2(c.y - TRACK_CENTER.y, c.x - TRACK_CENTER.x)
}
