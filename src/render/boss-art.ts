import type { BossKey, MonsterSize } from '../core/types'

/**
 * Boss silhouettes, drawn rather than illustrated.
 *
 * Trash monsters are flat coloured discs. A boss has to read as a creature at
 * roughly 44 pixels, next to 36-pixel unit tiles, on a near-black board — and a
 * downloaded pixel-art sprite loses that fight twice over: it fights the clean
 * vector look of everything else, and at that size it is mush.
 *
 * Three rules make a shape menacing at this size, and every boss here uses all
 * three:
 *
 *   dark interior   a lit disc is a ball; a dark one with a bright rim is a hole
 *   outward points  spikes, teeth, horns — anything that breaks the circle
 *   eyes            the single strongest "this is alive" signal, and the one
 *                   thing still legible at 20px
 *
 * On top of that, each boss's outline says what it does, so the silhouette and
 * the HUD tell agree. The Shifter literally changes its number of sides; the
 * Broodmother carries eight sacs because it drops eight monsters.
 */

/** Slow enough to read as menace rather than a spinner. */
const SPIN = 0.35

/**
 * Draws a boss and returns its visual extent — how far it reaches from centre.
 *
 * The caller frames it with rings, a health bar and a name, and those have to
 * sit outside the art. A spiked boss reaches further than its body radius, so
 * the number is reported back rather than assumed.
 */
export function drawBossBody(
  ctx: CanvasRenderingContext2D,
  key: BossKey,
  color: string,
  cx: number,
  cy: number,
  r: number,
  elapsed: number,
  size: MonsterSize,
): number {
  switch (key) {
    case 'gatekeeper':
      return drawGatekeeper(ctx, color, cx, cy, r)
    case 'broodmother':
      return drawBroodmother(ctx, color, cx, cy, r, elapsed)
    case 'shifter':
      return drawShifter(ctx, color, cx, cy, r, elapsed, size)
    case 'warden':
      return drawWarden(ctx, color, cx, cy, r, elapsed)
    case 'revenant':
      return drawRevenant(ctx, color, cx, cy, r, elapsed)
    case 'worldeater':
      return drawWorldeater(ctx, color, cx, cy, r, elapsed)
  }
}

// --- Shared vocabulary ----------------------------------------------------

/** Dark in the middle, lit at the edge: a hole in the board, not a marble. */
function body(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  const g = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r)
  g.addColorStop(0, `${color}55`)
  g.addColorStop(0.55, '#140f1c')
  g.addColorStop(1, '#0a0d14')
  ctx.fillStyle = g
  ctx.fill()

  ctx.strokeStyle = color
  ctx.lineWidth = 2.2
  ctx.stroke()
}

/**
 * A white core inside a coloured bloom.
 *
 * White rather than the boss colour on purpose: at this size a coloured dot on
 * a coloured body disappears, and the glow already carries the identity.
 */
function eye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  tilt = 0,
): void {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = 9
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(x, y, rx, ry, tilt, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function polygonPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rot: number,
): void {
  ctx.beginPath()
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/** Alternating inner and outer radius — the generic "it has points" shape. */
function spikePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  points: number,
  rot: number,
): void {
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2
    const rr = i % 2 === 0 ? outer : inner
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

// --- The six --------------------------------------------------------------

/**
 * Gatekeeper — the wall. Blunt octagonal armour and a pair of horns, with a
 * single barred visor instead of eyes. It is the only boss that does not move:
 * the one with no trait should look like it does not need one.
 */
function drawGatekeeper(
  ctx: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  r: number,
): number {
  // Horns first, so the plating overlaps their roots. Kept short: longer ones
  // read as a mascot's ears and pushed the whole silhouette off balance.
  ctx.fillStyle = color
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx + side * r * 0.5, cy - r * 0.62)
    ctx.lineTo(cx + side * r * 0.92, cy - r * 1.0)
    ctx.lineTo(cx + side * r * 0.84, cy - r * 0.5)
    ctx.closePath()
    ctx.fill()
  }

  polygonPath(ctx, cx, cy, r, 8, Math.PI / 8)
  body(ctx, cx, cy, r, color)

  // Visor: one slot, barred. Reads as armour rather than a face.
  ctx.fillStyle = '#0a0d14'
  ctx.fillRect(cx - r * 0.62, cy - r * 0.16, r * 1.24, r * 0.34)
  eye(ctx, cx - r * 0.3, cy, r * 0.17, r * 0.1, color)
  eye(ctx, cx + r * 0.3, cy, r * 0.17, r * 0.1, color)

  return r * 1.05
}

/**
 * Broodmother — eight sacs around a swollen body, one per monster it drops, and
 * a cluster of small eyes. The sacs swell on a slow pulse so it looks gravid
 * rather than decorative.
 */
function drawBroodmother(
  ctx: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  r: number,
  elapsed: number,
): number {
  const sacs = 8
  const swell = 1 + 0.1 * Math.sin(elapsed * 2.2)

  // Evenly spaced same-size circles around a disc is a flower, which is the
  // first thing this looked like. Jitter is what makes it a clutch of eggs:
  // sizes and distances vary, and sacs sink into the body instead of ringing
  // it. Derived from the index so it is stable frame to frame.
  for (let i = 0; i < sacs; i++) {
    const n = Math.sin(i * 12.9898) * 43758.5453
    const jitter = n - Math.floor(n)
    const a = (i / sacs) * Math.PI * 2 + elapsed * 0.1 + jitter * 0.5
    const d = r * (0.66 + jitter * 0.26)
    const sr = r * (0.16 + jitter * 0.14) * swell

    ctx.fillStyle = '#17100c'
    ctx.beginPath()
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, sr, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = `${color}cc`
    ctx.lineWidth = 1.4
    ctx.stroke()
  }

  // Squat and wide — a body carrying something.
  ctx.beginPath()
  ctx.ellipse(cx, cy + r * 0.06, r * 0.84, r * 0.72, 0, 0, Math.PI * 2)
  body(ctx, cx, cy, r * 0.8, color)

  // Five eyes, uneven — symmetry would read as a machine.
  eye(ctx, cx - r * 0.3, cy - r * 0.16, r * 0.1, r * 0.08, color, 0.5)
  eye(ctx, cx + r * 0.04, cy - r * 0.26, r * 0.08, r * 0.07, color)
  eye(ctx, cx + r * 0.33, cy - r * 0.09, r * 0.09, r * 0.07, color, -0.5)
  eye(ctx, cx - r * 0.13, cy + r * 0.14, r * 0.07, r * 0.06, color)
  eye(ctx, cx + r * 0.19, cy + r * 0.2, r * 0.06, r * 0.05, color)

  return r * 1.15
}

/**
 * Shifter — the side count IS the trait. Three sides as a Small, five as a
 * Medium, eight as a Large, so a player can read which matchup they are facing
 * from the shape alone and never has to watch the HUD for it.
 */
function drawShifter(
  ctx: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  r: number,
  elapsed: number,
  size: MonsterSize,
): number {
  const sides = size === 'small' ? 3 : size === 'medium' ? 5 : 8
  const rot = elapsed * SPIN

  // A ghost of the shape, offset — it never looks settled in one form.
  ctx.save()
  ctx.globalAlpha = 0.25
  polygonPath(ctx, cx, cy, r * 1.12, sides, rot + 0.3)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()

  polygonPath(ctx, cx, cy, r, sides, rot)
  body(ctx, cx, cy, r, color)

  // One eye, because a single unblinking one is worse than a pair.
  eye(ctx, cx, cy, r * 0.2, r * 0.26, color)

  return r * 1.15
}

/**
 * Warden — a segmented shield. The gaps between plates echo the per-hit cap:
 * it is visibly built to take blows in portions. One wide visor, no pupils.
 */
function drawWarden(
  ctx: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  r: number,
  elapsed: number,
): number {
  const plates = 6
  const rot = elapsed * SPIN * 0.5

  for (let i = 0; i < plates; i++) {
    const a0 = rot + (i / plates) * Math.PI * 2 + 0.08
    const a1 = rot + ((i + 1) / plates) * Math.PI * 2 - 0.08
    ctx.beginPath()
    ctx.arc(cx, cy, r * 1.14, a0, a1)
    ctx.arc(cx, cy, r * 0.92, a1, a0, true)
    ctx.closePath()
    ctx.fillStyle = `${color}44`
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.3
    ctx.stroke()
  }

  polygonPath(ctx, cx, cy, r * 0.9, 6, Math.PI / 6)
  body(ctx, cx, cy, r * 0.9, color)

  ctx.fillStyle = '#0a0d14'
  ctx.fillRect(cx - r * 0.5, cy - r * 0.12, r, r * 0.26)
  eye(ctx, cx, cy, r * 0.42, r * 0.07, color)

  return r * 1.2
}

/**
 * Revenant — a tatter, not a body. The outline is perturbed by a travelling
 * wave so its edge never holds still, heavier at the bottom so it reads as
 * cloth hanging. Hollow eye sockets: rings, not dots.
 */
function drawRevenant(
  ctx: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  r: number,
  elapsed: number,
): number {
  const steps = 72

  ctx.beginPath()
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2
    // A gentle wobble all round reads as a slime. The shape has to be narrow
    // and hooded at the top and come to torn points at the bottom, so the
    // fraying is weighted to the lower half and sharpened there.
    const hang = Math.max(0, Math.sin(a))
    const tear = Math.abs(Math.sin(a * 4 + elapsed * 3.6)) ** 0.6
    const narrow = 1 - 0.22 * Math.max(0, -Math.sin(a))
    const rr = r * narrow - r * 0.34 * tear * hang
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  body(ctx, cx, cy, r, color)

  // Filled rather than hollow: an outline reads as a smudge once the body is
  // only forty pixels wide. The tilt is what keeps it a scowl — inner ends down.
  for (const side of [-1, 1]) {
    eye(ctx, cx + side * r * 0.32, cy - r * 0.22, r * 0.19, r * 0.1, color, side * 0.55)
  }

  return r * 1.1
}

/**
 * Worldeater — a mouth. A ring of inward teeth around a gullet that is darker
 * than the board, with the eyes pushed out to the edge where they belong on
 * something that is mostly jaw.
 */
function drawWorldeater(
  ctx: CanvasRenderingContext2D,
  color: string,
  cx: number,
  cy: number,
  r: number,
  elapsed: number,
): number {
  const teeth = 11
  const gape = 1 + 0.07 * Math.sin(elapsed * 1.8)

  spikePath(ctx, cx, cy, r * 0.95, r * 1.2, teeth, elapsed * SPIN * 0.6)
  body(ctx, cx, cy, r * 1.1, color)

  // The gullet: the one thing on the board darker than the background.
  ctx.fillStyle = '#05070b'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.52 * gape, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = `${color}aa`
  ctx.lineWidth = 1.4
  ctx.stroke()

  eye(ctx, cx - r * 0.74, cy - r * 0.4, r * 0.12, r * 0.09, color, -0.4)
  eye(ctx, cx + r * 0.74, cy - r * 0.4, r * 0.12, r * 0.09, color, 0.4)

  return r * 1.3
}
