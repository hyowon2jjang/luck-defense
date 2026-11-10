/**
 * Prints the geometry of the build area: how many of each unit fit inside the
 * ring, and where each class's coverage peaks.
 *
 * Floor space is a balance resource, so these numbers belong next to the
 * clear-rate numbers when tuning.
 *
 *   npm run report
 */
import {
  INNER_LIMIT,
  TRACK_RADIUS,
  capacityFor,
  coverage,
  placeableAnchors,
  radiusOf,
} from '../core/data/board'
import { CLASSES } from '../core/data/classes'

console.log(`track radius   ${TRACK_RADIUS}`)
console.log(`build radius   ${INNER_LIMIT}  (inside only)`)
console.log()
console.log('class    size   legal spots   can shoot   packed max   peak coverage')

for (const def of Object.values(CLASSES)) {
  const anchors = placeableAnchors(def.footprint)

  let peak = 0
  let peakRadius = 0
  for (const anchor of anchors) {
    const r = radiusOf(anchor, def.footprint)
    const c = coverage(r, def.range)
    if (c > peak) {
      peak = c
      peakRadius = r
    }
  }

  // Anchors from which this class can reach the track at all. Auto-placement
  // skips the rest, because a unit that cannot fire is not a placement.
  const live = anchors.filter(
    (a) => coverage(radiusOf(a, def.footprint), def.range) > 0,
  ).length

  console.log(
    `${def.name.padEnd(8)} ${def.footprint}x${def.footprint}    ` +
      `${String(anchors.length).padStart(6)}      ` +
      `${String(live).padStart(6)}      ` +
      `${String(capacityFor(def.footprint)).padStart(6)}        ` +
      `${(peak * 100).toFixed(0)}% at r=${peakRadius.toFixed(0)}`,
  )
}
