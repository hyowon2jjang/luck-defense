import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  anchorAt,
  anchorRect,
  canPlace,
  coverage,
  radiusOf,
} from '../core/data/board'
import { CLASSES, CLASS_IDS, DAMAGE_MATRIX, unitName } from '../core/data/classes'
import { BOSS_BY_KEY } from '../core/data/bosses'
import { TIERS, TIER_BY_KEY, TIER_ORDER, nextTier } from '../core/data/tiers'
import {
  ROLL_COST,
  SELL_REFUND,
  canSkip,
  createGame,
  dispatch,
  skipBounty,
  tick,
} from '../core/game'
import { hasRoom, ringCapacity } from '../core/systems/placement'
import { attackInterval, projectileDamage, upgradeMultiplier } from '../core/systems/combat'
import {
  isMuted,
  playBossDeath,
  playBossSpawn,
  playDeaths,
  playHits,
  playReward,
  playRoll,
  playWarning,
  playWave,
  playWaveStart,
  setMuted,
} from './sfx'
import {
  clearRun,
  loadRun,
  loadStats,
  recordRun,
  saveRun,
} from './persistence'
import type { Stats } from './persistence'
import {
  SPEEDS,
  SPEED_UNLOCK,
  clearedWaves,
  loadBestWave,
  saveBestWave,
  speedUnlocked,
} from './progress'
import type { Speed } from './progress'
import {
  TOTAL_MONSTERS,
  TRACK_CAUTION,
  TRACK_LIMIT,
  TRACK_WARN,
  WAVE_COUNT,
  waveDef,
  waveMix,
} from '../core/data/waves'
import { render } from '../render/renderer'
import { createFx } from '../render/effects'
import type { Fx } from '../render/effects'
import type { ViewState } from '../render/renderer'
import type {
  ClassId,
  Command,
  DamageType,
  GameState,
  MonsterSize,
  RewardChoice,
  TierKey,
  Unit,
} from '../core/types'

const SIZES: MonsterSize[] = ['small', 'medium', 'large']

/** Lowest tier that can be enhanced at all, for the explanatory hint. */
const FIRST_ENHANCEABLE = TIERS.find((t) => t.enhanceCost !== null)?.name ?? 'Ancient'

/**
 * Pixels the pointer must travel before a press counts as a drag. Below this a
 * click only selects, so units never shift from a stray click.
 */
const DRAG_THRESHOLD = 5

/** Logic runs at a fixed rate so the simulation is frame-rate independent. */
const FIXED_DT = 1 / 60
/** Guard against huge catch-up loops after a tab has been backgrounded. */
const MAX_CATCHUP = 0.25

export { SPEEDS } from './progress'
export type { Speed } from './progress'

const HUD_INTERVAL = 0.1
/** Seconds between autosaves. */
const SAVE_INTERVAL = 2

export type UnitGroup = {
  classId: ClassId
  tier: TierKey
  name: string
  count: number
  tierColor: string
}

export type TierRow = {
  key: TierKey
  name: string
  color: string
  probability: number
  damageMultiplier: number
  attackSpeed: number
  enhanceCost: number | null
  enhanceChance: number
}

export type ActiveUnit = {
  id: number
  name: string
  classId: ClassId
  className: string
  tier: TierKey
  tierName: string
  tierColor: string
  damageType: DamageType
  /** Fraction of the track reachable from where it would stand. */
  coverage: number
  fielded: boolean
  holding: boolean

  dps: number
  /** Shown next to DPS, because the tier bonus is otherwise invisible. */
  attacksPerSecond: number
  range: number
  hits: number
  /** Blast radius, after the tier widens it. */
  splash: number
  /** Share dealt to everything else in range. Zero below Myth. */
  lineShare: number
  kills: number
  damage: number
  recruitedOnWave: number
  /** Damage multiplier vs each monster size, after type and upgrades. */
  vsSize: { size: MonsterSize; multiplier: number }[]

  /** Null where enhancement is not offered for this tier. */
  enhance: { cost: number; chance: number; nextName: string } | null
  /** Why there is no enhance button, when there isn't one. */
  enhanceHint: string | null
}

/** A roster row selected as a whole, for inspecting and selling in bulk. */
export type ActiveGroup = {
  classId: ClassId
  tier: TierKey
  name: string
  className: string
  tierName: string
  tierColor: string
  count: number
  kills: number
  damage: number
  refund: number
  /** Same tier across all three classes — the wider "sell all Commons" sweep. */
  tierCount: number
  tierRefund: number
}

export type Reveal = {
  /** Increments every reveal so the same result still replays the animation. */
  nonce: number
  kind: 'roll' | 'enhance' | 'failed'
  name: string
  classId: ClassId
  tier: TierKey
  tierName: string
  tierColor: string
  /** 0-7. Drives how loud the presentation gets. */
  rank: number
}

/**
 * A boss reward waiting on a decision.
 *
 * The unit option is expanded into one entry per class here rather than in the
 * component: which class to take it in IS the decision, so the three names have
 * to be readable side by side.
 */
export type PendingReward = {
  id: number
  wave: number
  bossName: string
  tier: TierKey
  tierName: string
  tierColor: string
  units: { classId: ClassId; name: string; className: string }[]
  points: number
  gold: number
  /** No room on the ring, so the unit option cannot be taken yet. */
  unitBlocked: boolean
}

/**
 * What the next wave is made of.
 *
 * The composition table is deliberate — all-Small waves punish a Blast board,
 * all-Large punish Pierce — but a schedule nobody can see is just variance.
 * Showing it a wave ahead is what turns it into "what should I roll now".
 */
export type NextWave = {
  wave: number
  counts: { size: MonsterSize; count: number }[]
  /** Named when the next wave is a boss, since then the mix is just the boss. */
  boss: string | null
}

/** The boss currently on the track, for the banner that names its trait. */
export type BossStatus = {
  name: string
  tell: string
  fraction: number
  color: string
  /** Its damage reduction is up right now, because something else is alive. */
  shielded: boolean
  /** It is healing right now. */
  healing: boolean
  /** Size it is showing right now, for a boss that rotates its size. */
  size: MonsterSize | null
}

export type Hud = {
  phase: GameState['phase']
  wave: number
  waveCount: number
  waveTimer: number
  finalTimer: number | null
  canSkip: boolean
  /** Gold the Skip button would pay right now. Zero on a clear track. */
  skipBounty: number
  /** Skip is held back until the wave has finished arriving. */
  spawning: boolean
  gold: number
  points: number
  rollCost: number
  sellRefund: number
  monsters: number
  trackLimit: number
  /** Filling up: still recoverable, so the HUD nudges rather than shouts. */
  caution: boolean
  /** Genuinely slipping. */
  warning: boolean
  kills: number
  totalMonsters: number
  fielded: number
  capacity: number
  /** Ring is full: recruiting is blocked until something is sold. */
  full: boolean
  upgrades: { damageType: DamageType; level: number; label: string; multiplier: number }[]
  groups: UnitGroup[]
  tierTable: TierRow[]
  /** Unclaimed boss rewards, oldest first. */
  rewards: PendingReward[]
  boss: BossStatus | null
  /** Null on the final wave, where there is no next. */
  nextWave: NextWave | null
}

const UPGRADE_LABELS: Record<DamageType, string> = {
  pierce: 'Pierce',
  balanced: 'Balanced',
  blast: 'Blast',
}

const CAPACITY = ringCapacity()

const TIER_TABLE: TierRow[] = TIERS.map((t) => ({
  key: t.key,
  name: t.name,
  color: t.color,
  probability: t.probability,
  damageMultiplier: t.damageMultiplier,
  attackSpeed: t.attackSpeed,
  enhanceCost: t.enhanceCost,
  enhanceChance: t.enhanceChance,
}))

/** The boss the banner should describe: the weakest one on track, if any. */
function bossStatus(s: GameState): BossStatus | null {
  let boss = null as (typeof s.monsters)[number] | null
  for (const m of s.monsters) {
    if (m.boss === null) continue
    if (boss === null || m.hp / m.maxHp < boss.hp / boss.maxHp) boss = m
  }
  if (boss === null) return null

  const def = BOSS_BY_KEY[boss.boss!]
  const others = s.monsters.some((m) => m !== boss && m.hp > 0)

  return {
    name: def.name,
    tell: def.tell,
    fraction: Math.max(0, boss.hp / boss.maxHp),
    color: def.color,
    shielded: def.escortedTaken < 1 && others,
    healing: def.regen > 0 && boss.hp < boss.maxHp,
    size: def.cycle ? boss.size : null,
  }
}

function pendingRewards(s: GameState): PendingReward[] {
  const blocked = !hasRoom(s)

  return s.rewards.map((offer) => {
    const tier = TIER_BY_KEY[offer.tier]
    return {
      id: offer.id,
      wave: offer.wave,
      bossName: BOSS_BY_KEY[offer.boss].name,
      tier: offer.tier,
      tierName: tier.name,
      tierColor: tier.color,
      units: CLASS_IDS.map((classId) => ({
        classId,
        name: unitName(classId, offer.tier),
        className: CLASSES[classId].name,
      })),
      points: offer.points,
      gold: offer.gold,
      unitBlocked: blocked,
    }
  })
}

function snapshot(s: GameState): Hud {
  const counts = new Map<string, { classId: ClassId; tier: TierKey; count: number }>()
  for (const u of s.units) {
    const key = `${u.classId}:${u.tier}`
    let entry = counts.get(key)
    if (!entry) {
      entry = { classId: u.classId, tier: u.tier, count: 0 }
      counts.set(key, entry)
    }
    entry.count++
  }

  const tierRank = new Map(TIERS.map((t, i) => [t.key, i]))
  const groups: UnitGroup[] = [...counts.values()]
    .map((g) => ({
      ...g,
      name: unitName(g.classId, g.tier),
      tierColor: TIER_BY_KEY[g.tier].color,
    }))
    .sort(
      (a, b) =>
        (tierRank.get(b.tier) ?? 0) - (tierRank.get(a.tier) ?? 0) ||
        a.classId.localeCompare(b.classId),
    )

  return {
    phase: s.phase,
    wave: s.wave,
    waveCount: WAVE_COUNT,
    waveTimer: s.waveTimer,
    finalTimer: s.finalTimer,
    canSkip: canSkip(s),
    skipBounty: skipBounty(s),
    spawning: s.spawnQueue.length > 0,
    gold: s.gold,
    points: s.points,
    rollCost: ROLL_COST,
    sellRefund: SELL_REFUND,
    monsters: s.monsters.length,
    trackLimit: TRACK_LIMIT,
    caution: s.monsters.length > TRACK_CAUTION,
    warning: s.monsters.length > TRACK_WARN,
    kills: s.kills,
    totalMonsters: TOTAL_MONSTERS,
    fielded: s.units.length,
    capacity: CAPACITY,
    full: !hasRoom(s),
    upgrades: (Object.keys(UPGRADE_LABELS) as DamageType[]).map((damageType) => ({
      damageType,
      level: s.upgrades[damageType],
      label: UPGRADE_LABELS[damageType],
      multiplier: upgradeMultiplier(s.upgrades[damageType]),
    })),
    groups,
    tierTable: TIER_TABLE,
    rewards: pendingRewards(s),
    boss: bossStatus(s),
    nextWave: nextWavePreview(s),
  }
}

function nextWavePreview(s: GameState): NextWave | null {
  const wave = s.wave + 1
  if (wave > WAVE_COUNT) return null

  const def = waveDef(wave)
  const mix = waveMix(wave)

  return {
    wave,
    counts: SIZES.filter((size) => mix[size] > 0).map((size) => ({
      size,
      count: mix[size],
    })),
    boss: def.boss ? BOSS_BY_KEY[def.boss].name : null,
  }
}

/**
 * Turns one frame of impacts into sound.
 *
 * Reads the tallies the renderer already produced, so audio never walks the
 * monster list itself and can never disagree with what was drawn. Wave and
 * saturation cues are edge-triggered off remembered state rather than counted.
 */
const heard = { wave: 0, warned: false, bossOnTrack: false, rewards: 0 }

function playFrame(state: GameState, fx: Fx): void {
  const ev = fx.events
  playHits('pierce', ev.hits.pierce)
  playHits('balanced', ev.hits.balanced)
  playHits('blast', ev.hits.blast)
  playWave(ev.waves)
  playDeaths(ev.deaths)
  for (let i = 0; i < ev.bossDeaths; i++) playBossDeath()

  if (state.wave !== heard.wave) {
    heard.wave = state.wave
    if (state.wave > 1) playWaveStart()
  }

  const bossUp = state.monsters.some((m) => m.boss !== null)
  if (bossUp && !heard.bossOnTrack) playBossSpawn()
  heard.bossOnTrack = bossUp

  // Edge-triggered: the alarm fires on crossing the line, not every frame past
  // it, so a long dangerous stretch stays one warning rather than a siren.
  const danger = state.monsters.length > TRACK_WARN
  if (danger && !heard.warned) playWarning()
  heard.warned = danger

  if (state.rewards.length > heard.rewards) playReward()
  heard.rewards = state.rewards.length
}

export function useGame(seed: number) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // A run in progress outranks the seed: closing the tab mid-wave should not
  // be the same as asking for a new game.
  const restored = useRef(loadRun()).current
  const stateRef = useRef<GameState>(restored?.state ?? createGame(seed))
  /** True only until the player starts a new run, for the "resumed" notice. */
  const [resumed, setResumed] = useState<boolean>(restored !== null)
  const seedRef = useRef<number>(restored?.seed ?? seed)
  const [stats, setStats] = useState<Stats>(loadStats)
  /** Rolls this run, which the lifetime record wants but GameState does not. */
  const rollsRef = useRef(0)
  const viewRef = useRef<ViewState>({
    activeUnitId: null,
    hoverAnchor: null,
    dragging: false,
    highlight: new Set<number>(),
  })
  /** Impact sparks and shake. Lives across frames; cleared with the run. */
  const fxRef = useRef<Fx>(createFx())
  /** A benched unit picked up from the roster, waiting for a click on the field. */
  const holdingRef = useRef<number | null>(null)
  /** Press in progress: which unit, where it started, and whether it became a drag. */
  const pressRef = useRef<{ unitId: number; x: number; y: number } | null>(null)
  /**
   * Clicked unit. Sticky: it survives the pointer leaving the canvas, which is
   * what makes the panel's Enhance and Sell buttons reachable at all.
   */
  const selectedRef = useRef<number | null>(null)
  /** Unit merely under the cursor. Only shown when nothing is selected. */
  const hoveredRef = useRef<number | null>(null)
  /** Roster row selected as a group. Mutually exclusive with a unit selection. */
  const groupRef = useRef<{ classId: ClassId; tier: TierKey } | null>(null)

  const [hud, setHud] = useState<Hud>(() => snapshot(stateRef.current))
  const [active, setActive] = useState<ActiveUnit | null>(null)
  const [group, setGroup] = useState<ActiveGroup | null>(null)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const revealNonce = useRef(0)
  const [muted, setMutedState] = useState<boolean>(isMuted)

  const toggleMute = useCallback(() => {
    setMutedState((was) => {
      setMuted(!was)
      return !was
    })
  }, [])

  const [speed, setSpeedState] = useState<Speed>(1)
  const speedRef = useRef<Speed>(1)
  /** Deepest wave cleared in any run, loaded once and kept in sync as it rises. */
  const [bestWave, setBestWave] = useState<number>(loadBestWave)
  const bestWaveRef = useRef<number>(bestWave)

  /** Which end-state has already been written to the record. */
  const recordedRef = useRef<GameState['phase'] | null>(
    restored && restored.state.phase !== 'playing' ? restored.state.phase : null,
  )

  const refreshHud = useCallback(() => setHud(snapshot(stateRef.current)), [])

  const setSpeed = useCallback((next: Speed) => {
    // Checked here rather than only in the buttons, so the keyboard shortcuts
    // and anything else calling this cannot route around the unlock.
    if (!speedUnlocked(next, bestWaveRef.current)) return
    speedRef.current = next
    setSpeedState(next)
  }, [])

  /**
   * Save the moment the tab goes away.
   *
   * `pagehide` rather than `beforeunload`: it is the one that fires reliably on
   * mobile, where a run is far more likely to be interrupted than finished.
   * `visibilitychange` covers switching apps without closing anything.
   */
  useEffect(() => {
    const flush = () => {
      if (stateRef.current.phase === 'playing') {
        saveRun(stateRef.current, seedRef.current)
      }
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [])

  /** 1 / 2 / 3 set the speed; space cycles through them. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      const index = SPEEDS.indexOf(Number(e.key) as Speed)
      if (index >= 0) {
        setSpeed(SPEEDS[index])
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        // Cycles through what is unlocked, so space never lands on a dead stop.
        const open = SPEEDS.filter((s) => speedUnlocked(s, bestWaveRef.current))
        const at = open.indexOf(speedRef.current)
        setSpeed(open[(at + 1) % open.length])
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSpeed])

  /** Rebuild the group card and the canvas highlight from the selected row. */
  const refreshGroup = useCallback(() => {
    const sel = groupRef.current
    const s = stateRef.current

    if (!sel) {
      viewRef.current.highlight = new Set()
      setGroup(null)
      return
    }

    const members = s.units.filter(
      (u) => u.classId === sel.classId && u.tier === sel.tier,
    )

    if (members.length === 0) {
      groupRef.current = null
      viewRef.current.highlight = new Set()
      setGroup(null)
      return
    }

    viewRef.current.highlight = new Set(members.map((u) => u.id))

    const tierCount = s.units.filter((u) => u.tier === sel.tier).length
    const tier = TIER_BY_KEY[sel.tier]

    setGroup({
      classId: sel.classId,
      tier: sel.tier,
      name: unitName(sel.classId, sel.tier),
      className: CLASSES[sel.classId].name,
      tierName: tier.name,
      tierColor: tier.color,
      count: members.length,
      kills: members.reduce((n, u) => n + u.kills, 0),
      damage: members.reduce((n, u) => n + u.damage, 0),
      refund: members.length * SELL_REFUND,
      tierCount,
      tierRefund: tierCount * SELL_REFUND,
    })
  }, [])

  /** Whoever the panel and the canvas overlay should be describing right now. */
  const resolveActive = useCallback(() => {
    const id = holdingRef.current ?? selectedRef.current ?? hoveredRef.current
    const alive = id !== null && stateRef.current.units.some((u) => u.id === id)
    viewRef.current.activeUnitId = alive ? id : null
    if (!alive) {
      if (selectedRef.current === id) selectedRef.current = null
      if (hoveredRef.current === id) hoveredRef.current = null
    }
  }, [])

  const refreshActive = useCallback(() => {
    resolveActive()
    const view = viewRef.current
    const s = stateRef.current
    const unit =
      view.activeUnitId === null
        ? null
        : s.units.find((u) => u.id === view.activeUnitId) ?? null

    if (!unit) {
      setActive(null)
      return
    }

    const def = CLASSES[unit.classId]
    const tier = TIER_BY_KEY[unit.tier]
    const promoted = nextTier(unit.tier)
    const anchor =
      view.hoverAnchor !== null && canPlace(view.hoverAnchor, def.footprint)
        ? view.hoverAnchor
        : unit.cell

    const perHit = projectileDamage(s, unit)

    setActive({
      id: unit.id,
      name: unitName(unit.classId, unit.tier),
      classId: unit.classId,
      className: def.name,
      tier: unit.tier,
      tierName: tier.name,
      tierColor: tier.color,
      damageType: def.damageType,
      coverage:
        anchor === null ? 0 : coverage(radiusOf(anchor, def.footprint), def.range),
      fielded: unit.cell !== null,
      holding: holdingRef.current === unit.id,

      dps: (perHit * def.hits) / attackInterval(unit),
      attacksPerSecond: 1 / attackInterval(unit),
      range: def.range,
      hits: def.hits,
      splash: def.splash * tier.splashScale,
      lineShare: tier.lineShare,
      kills: unit.kills,
      damage: unit.damage,
      recruitedOnWave: unit.recruitedOnWave,
      vsSize: SIZES.map((size) => ({
        size,
        multiplier: DAMAGE_MATRIX[def.damageType][size],
      })),
      enhance:
        tier.enhanceCost === null || promoted === null
          ? null
          : {
              cost: tier.enhanceCost,
              chance: tier.enhanceChance,
              nextName: TIER_BY_KEY[promoted].name,
            },
      enhanceHint:
        tier.enhanceCost !== null && promoted !== null
          ? null
          : promoted === null
            ? 'Top tier — nothing above this.'
            : `Too common to enhance. Starts at ${FIRST_ENHANCEABLE}.`,
    })
  }, [resolveActive])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = FIELD_WIDTH * dpr
    canvas.height = FIELD_HEIGHT * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    let raf = 0
    let last = performance.now()
    let accumulator = 0
    let hudTimer = 0
    let saveTimer = 0

    const frame = (now: number) => {
      const elapsed = Math.min((now - last) / 1000, MAX_CATCHUP)
      last = now
      accumulator += elapsed * speedRef.current

      while (accumulator >= FIXED_DT) {
        tick(stateRef.current, FIXED_DT)
        accumulator -= FIXED_DT
      }

      render(ctx, stateRef.current, viewRef.current, fxRef.current)
      playFrame(stateRef.current, fxRef.current)

      hudTimer += elapsed
      if (hudTimer >= HUD_INTERVAL) {
        hudTimer = 0
        setHud(snapshot(stateRef.current))

        // Autosave is on its own slower beat: serialising the board ten times
        // a second is wasted work, and two seconds of lost progress is a wave
        // timer, not a run.
        saveTimer += HUD_INTERVAL
        if (saveTimer >= SAVE_INTERVAL) {
          saveTimer = 0
          saveRun(stateRef.current, seedRef.current)
        }

        // The run just ended: fold it into the lifetime record exactly once.
        const phase = stateRef.current.phase
        if (phase !== 'playing' && phase !== recordedRef.current) {
          recordedRef.current = phase
          setStats(recordRun(stateRef.current, rollsRef.current))
          clearRun()
        }

        // Banked as the run goes rather than at the end, so a run that is
        // abandoned or closed mid-way still keeps what it reached.
        const cleared = clearedWaves(stateRef.current)
        if (cleared > bestWaveRef.current) {
          bestWaveRef.current = saveBestWave(cleared)
          setBestWave(bestWaveRef.current)
        }
        // The selected unit's kill count ticks up while you watch it.
        if (viewRef.current.activeUnitId !== null) refreshActive()
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [refreshActive])

  const announce = useCallback((kind: 'roll' | 'enhance', unit: Unit) => {
    const tier = TIER_BY_KEY[unit.tier]
    const rank = TIER_ORDER.indexOf(unit.tier)
    revealNonce.current++
    setReveal({
      nonce: revealNonce.current,
      kind,
      name: unitName(unit.classId, unit.tier),
      classId: unit.classId,
      tier: unit.tier,
      tierName: tier.name,
      tierColor: tier.color,
      rank,
    })
    playRoll(rank)
  }, [])

  const announceFailure = useCallback((unit: Unit) => {
    revealNonce.current++
    setReveal({
      nonce: revealNonce.current,
      kind: 'failed',
      name: unitName(unit.classId, unit.tier),
      classId: unit.classId,
      tier: unit.tier,
      tierName: 'Enhance failed',
      tierColor: '#f87171',
      rank: 0,
    })
  }, [])

  const send = useCallback(
    (cmd: Command) => {
      const ok = dispatch(stateRef.current, cmd)

      // A roll appends its unit, so the tail is what just came out.
      if (ok && cmd.kind === 'roll') {
        rollsRef.current++
        const unit = stateRef.current.units[stateRef.current.units.length - 1]
        if (unit) announce('roll', unit)
      }

      refreshHud()
      return ok
    },
    [announce, refreshHud],
  )

  const enhanceUnit = useCallback(
    (unitId: number) => {
      const s = stateRef.current
      const unit = s.units.find((u) => u.id === unitId)
      if (!unit) return

      const before = unit.tier
      if (!dispatch(s, { kind: 'enhance', unitId })) return

      if (unit.tier === before) announceFailure(unit)
      else announce('enhance', unit)

      refreshHud()
      refreshActive()
    },
    [announce, announceFailure, refreshActive, refreshHud],
  )

  /**
   * Take one option from a boss reward.
   *
   * A granted unit reuses the roll reveal: it arrives the same way a rolled unit
   * does, and at these tiers it deserves the same fanfare.
   */
  const claimReward = useCallback(
    (offerId: number, choice: RewardChoice, classId?: ClassId) => {
      const s = stateRef.current
      if (!dispatch(s, { kind: 'claim', offerId, choice, classId })) return false

      if (choice === 'unit') {
        const unit = s.units[s.units.length - 1]
        if (unit) announce('roll', unit)
      }

      refreshHud()
      return true
    },
    [announce, refreshHud],
  )

  const sellUnit = useCallback(
    (unitId: number) => {
      send({ kind: 'sell', unitId })

      if (selectedRef.current === unitId) selectedRef.current = null
      if (hoveredRef.current === unitId) hoveredRef.current = null
      if (holdingRef.current === unitId) holdingRef.current = null
      if (pressRef.current?.unitId === unitId) pressRef.current = null
      viewRef.current.hoverAnchor = null
      refreshActive()
    },
    [refreshActive, send],
  )

  // --- Pointer interaction ------------------------------------------------

  const pointFromEvent = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * FIELD_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * FIELD_HEIGHT,
    }
  }, [])

  const unitAtPoint = useCallback((x: number, y: number): Unit | null => {
    for (const u of stateRef.current.units) {
      if (u.cell === null) continue
      const r = anchorRect(u.cell, CLASSES[u.classId].footprint)
      if (x >= r.x && x < r.x + r.side && y >= r.y && y < r.y + r.side) return u
    }
    return null
  }, [])

  const updateHover = useCallback(
    (x: number, y: number, unit: Unit | null) => {
      const size = unit ? CLASSES[unit.classId].footprint : 2
      viewRef.current.hoverAnchor = anchorAt(x, y, size)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const view = viewRef.current
      const { x, y } = pointFromEvent(e)
      const s = stateRef.current

      // A press only becomes a drag once the pointer has actually travelled.
      const press = pressRef.current
      if (press && !view.dragging) {
        if (Math.hypot(x - press.x, y - press.y) >= DRAG_THRESHOLD) view.dragging = true
      }

      if (!view.dragging && press === null && holdingRef.current === null) {
        hoveredRef.current = unitAtPoint(x, y)?.id ?? null
      }
      resolveActive()

      const unit = s.units.find((u) => u.id === view.activeUnitId) ?? null

      if (view.dragging || holdingRef.current !== null) {
        updateHover(x, y, unit)
      } else {
        // Not moving anything: no ghost, just the range preview in place.
        view.hoverAnchor = null
      }
      refreshActive()
    },
    [pointFromEvent, refreshActive, resolveActive, unitAtPoint, updateHover],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const view = viewRef.current
      const { x, y } = pointFromEvent(e)

      // Placing a unit picked up from the roster.
      const holding = holdingRef.current
      if (holding !== null) {
        const unit = stateRef.current.units.find((u) => u.id === holding)
        if (unit) {
          updateHover(x, y, unit)
          const anchor = view.hoverAnchor
          if (anchor !== null && canPlace(anchor, CLASSES[unit.classId].footprint)) {
            send({ kind: 'place', unitId: holding, cell: anchor })
            holdingRef.current = null
            view.hoverAnchor = null
            // Keep the unit you just placed selected, so it stays inspectable.
            selectedRef.current = unit.id
          }
        }
        refreshActive()
        return
      }

      const unit = unitAtPoint(x, y)
      if (!unit) {
        // Clicking bare ground is how you deselect.
        selectedRef.current = null
        hoveredRef.current = null
        groupRef.current = null
        refreshGroup()
        refreshActive()
        return
      }

      // Arm the press. It only turns into a move if the pointer travels.
      pressRef.current = { unitId: unit.id, x, y }
      selectedRef.current = unit.id
      groupRef.current = null
      refreshGroup()
      view.hoverAnchor = null
      e.currentTarget.setPointerCapture(e.pointerId)
      refreshActive()
    },
    [pointFromEvent, refreshActive, refreshGroup, send, unitAtPoint, updateHover],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const view = viewRef.current
      const press = pressRef.current
      pressRef.current = null

      if (press === null) return
      e.currentTarget.releasePointerCapture(e.pointerId)

      // A click that never moved selects only — the unit stays put.
      if (!view.dragging) {
        refreshActive()
        return
      }

      view.dragging = false
      const unit = stateRef.current.units.find((u) => u.id === press.unitId)
      const anchor = view.hoverAnchor
      if (unit && anchor !== null && canPlace(anchor, CLASSES[unit.classId].footprint)) {
        send({ kind: 'place', unitId: unit.id, cell: anchor })
      }
      view.hoverAnchor = null
      refreshActive()
    },
    [refreshActive, send],
  )

  const onPointerLeave = useCallback(() => {
    const view = viewRef.current
    // While dragging the canvas holds pointer capture, and browsers differ on
    // whether leave fires. Ignoring it keeps a drag alive across the edge.
    if (view.dragging || pressRef.current !== null) return

    // Only the hover is dropped. A selection has to survive the trip to the
    // panel, or its buttons could never be clicked.
    view.hoverAnchor = null
    hoveredRef.current = null
    refreshActive()
  }, [refreshActive])

  // --- Roster group selection ---------------------------------------------

  /** Select a roster row, or click it again to deselect. */
  const selectGroup = useCallback(
    (classId: ClassId, tier: TierKey) => {
      const current = groupRef.current
      const same = current?.classId === classId && current?.tier === tier

      groupRef.current = same ? null : { classId, tier }
      // A group and a single unit are never selected at the same time.
      selectedRef.current = null
      hoveredRef.current = null

      refreshGroup()
      refreshActive()
    },
    [refreshActive, refreshGroup],
  )

  const clearGroup = useCallback(() => {
    groupRef.current = null
    refreshGroup()
  }, [refreshGroup])

  const sellMany = useCallback(
    (units: Unit[]) => {
      const s = stateRef.current
      for (const unit of units) dispatch(s, { kind: 'sell', unitId: unit.id })

      groupRef.current = null
      selectedRef.current = null
      hoveredRef.current = null
      refreshGroup()
      refreshActive()
      refreshHud()
    },
    [refreshActive, refreshGroup, refreshHud],
  )

  /** Sell every unit of one class at one tier — the selected roster row. */
  const sellGroup = useCallback(
    (classId: ClassId, tier: TierKey) => {
      sellMany(
        stateRef.current.units.filter((u) => u.classId === classId && u.tier === tier),
      )
    },
    [sellMany],
  )

  /** Sell every unit of a tier, across all three classes. */
  const sellTier = useCallback(
    (tier: TierKey) => {
      sellMany(stateRef.current.units.filter((u) => u.tier === tier))
    },
    [sellMany],
  )

  const reset = useCallback(
    (nextSeed: number) => {
      clearRun()
      stateRef.current = createGame(nextSeed)
      seedRef.current = nextSeed
      recordedRef.current = null
      rollsRef.current = 0
      setResumed(false)
      viewRef.current = {
        activeUnitId: null,
        hoverAnchor: null,
        dragging: false,
        highlight: new Set(),
      }
      fxRef.current = createFx()
      holdingRef.current = null
      pressRef.current = null
      selectedRef.current = null
      hoveredRef.current = null
      groupRef.current = null
      setActive(null)
      setGroup(null)
      setReveal(null)
      refreshHud()
    },
    [refreshHud],
  )

  const speedOptions = SPEEDS.map((value) => ({
    value,
    unlocked: speedUnlocked(value, bestWave),
    /** Waves that must be cleared for it. Zero where nothing is required. */
    requires: SPEED_UNLOCK[value],
  }))

  return {
    canvasRef,
    hud,
    active,
    group,
    reveal,
    speed,
    speeds: SPEEDS,
    speedOptions,
    bestWave,
    stats,
    resumed,
    muted,
    toggleMute,
    setSpeed,
    send,
    sellUnit,
    enhanceUnit,
    claimReward,
    selectGroup,
    clearGroup,
    sellGroup,
    sellTier,
    reset,
    classes: CLASSES,
    pointer: { onPointerMove, onPointerDown, onPointerUp, onPointerLeave },
  }
}
