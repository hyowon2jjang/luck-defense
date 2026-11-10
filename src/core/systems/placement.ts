import { CLASSES, CLASS_IDS } from '../data/classes'
import {
  canPlace,
  coverage,
  footprintCells,
  placeableAnchors,
  radiusOf,
} from '../data/board'
import type { ClassId, GameState, Unit } from '../types'

/** Largest footprint in the game; room checked against it always fits. */
const MAX_FOOTPRINT = Math.max(...CLASS_IDS.map((c) => CLASSES[c].footprint))

/**
 * Legal anchors ordered from the middle of the ring outwards.
 *
 * Auto-placement fills the interior centre-first and nothing else. It is not
 * trying to be clever — positioning is the player's job, and a predictable
 * fill order is easier to reason about than a solver picking scattered spots.
 */
const CENTRE_OUT = new Map<number, readonly number[]>()

function centreOut(size: number): readonly number[] {
  let list = CENTRE_OUT.get(size)
  if (!list) {
    list = [...placeableAnchors(size)].sort(
      (a, b) => radiusOf(a, size) - radiusOf(b, size),
    )
    CENTRE_OUT.set(size, list)
  }
  return list
}

/** Cells currently covered by a unit. */
export function occupiedCells(state: GameState, ignoreUnitId?: number): Set<number> {
  const taken = new Set<number>()
  for (const u of state.units) {
    if (u.cell === null || u.id === ignoreUnitId) continue
    for (const c of footprintCells(u.cell, CLASSES[u.classId].footprint)) taken.add(c)
  }
  return taken
}

/** Units whose footprint would overlap a placement. */
export function unitsOverlapping(
  state: GameState,
  anchor: number,
  size: number,
  ignoreUnitId?: number,
): Unit[] {
  const cells = new Set(footprintCells(anchor, size))
  return state.units.filter((u) => {
    if (u.cell === null || u.id === ignoreUnitId) return false
    return footprintCells(u.cell, CLASSES[u.classId].footprint).some((c) => cells.has(c))
  })
}

/**
 * Anchors a class can actually shoot from, innermost first.
 *
 * Range is measured from the unit to the track, so the deepest part of the ring
 * is out of reach for the shorter ranges — about r < 60 for the Archer's 140,
 * r < 35 for the Ninja, and nothing at all for the Mage's 190.
 */
const LIVE = new Map<ClassId, readonly number[]>()

function liveAnchors(classId: ClassId): readonly number[] {
  let list = LIVE.get(classId)
  if (!list) {
    const def = CLASSES[classId]
    list = centreOut(def.footprint).filter(
      (anchor) => coverage(radiusOf(anchor, def.footprint), def.range) > 0,
    )
    LIVE.set(classId, list)
  }
  return list
}

/**
 * Innermost free anchor for a class, or null when the ring is full.
 *
 * Fills centre-first, but skips the slots this class cannot fire from. That
 * dead zone used to be handed out first, and it quietly broke the Archer: with
 * a small board every unit landed inside its own blind spot, so an Archer-only
 * run scored three kills in thirty waves and starved by wave six.
 *
 * This is not the clever auto-placement chapter 5 argues against. Positioning
 * is still the player's job — radius within the live band, angle, priority. A
 * slot the unit cannot shoot from is not one of those choices; it is a trap,
 * and the opening move should not be one.
 *
 * Dead slots are still used once nothing live is left, because the ring's
 * capacity is a rule and losing seats to this would quietly change it.
 */
export function firstFreeAnchor(
  state: GameState,
  classId: ClassId,
  ignoreUnitId?: number,
): number | null {
  const size = CLASSES[classId].footprint
  const taken = occupiedCells(state, ignoreUnitId)
  const free = (anchor: number) => !footprintCells(anchor, size).some((c) => taken.has(c))

  for (const anchor of liveAnchors(classId)) if (free(anchor)) return anchor
  for (const anchor of centreOut(size)) if (free(anchor)) return anchor
  return null
}

/**
 * Whether any unit could still be fielded.
 *
 * There is no bench: a unit that cannot stand on the field does not exist. So
 * a full ring blocks recruiting outright, and selling is the only way to make
 * room — which is what gives selling its job.
 */
export function hasRoom(state: GameState): boolean {
  const taken = occupiedCells(state)
  for (const anchor of centreOut(MAX_FOOTPRINT)) {
    if (!footprintCells(anchor, MAX_FOOTPRINT).some((c) => taken.has(c))) return true
  }
  return false
}

/** Total units the ring can hold, ignoring who is standing where. */
export function ringCapacity(): number {
  return centreOut(MAX_FOOTPRINT).length > 0 ? countPacked(MAX_FOOTPRINT) : 0
}

function countPacked(size: number): number {
  const taken = new Set<number>()
  let total = 0
  for (const anchor of centreOut(size)) {
    const cells = footprintCells(anchor, size)
    if (cells.some((c) => taken.has(c))) continue
    for (const c of cells) taken.add(c)
    total++
  }
  return total
}

/** Manual placement: legal if the whole footprint fits inside the ring. */
export function canPlaceUnit(unit: Unit, anchor: number): boolean {
  return canPlace(anchor, CLASSES[unit.classId].footprint)
}
