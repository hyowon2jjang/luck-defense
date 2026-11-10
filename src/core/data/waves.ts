import { bossForWave } from './bosses'
import type { BossKey, MonsterSize } from '../types'

export type WaveDef = {
  wave: number
  count: number
  /** Size pattern, cycled to fill `count`. */
  pattern: readonly MonsterSize[]
  /** HP of what actually spawns — the boss's own total on a boss wave. */
  hp: number
  /**
   * HP of this wave's trash, boss waves included. Kept separate because a
   * Broodmother's spawn is priced off its own wave's trash, not off itself.
   */
  trashHp: number
  speed: number
  boss: BossKey | null
}

export const WAVE_COUNT = 30
export const WAVE_DURATION = 30
export const BOSS_INTERVAL = 5

/**
 * Track saturation, in two steps before the loss.
 *
 * One threshold at 80 told the player they were in trouble at the point where
 * there was little left to do about it. CAUTION fires while skipping, selling
 * and repositioning can all still turn it around; WARN is the line where the
 * run is genuinely slipping. Over LIMIT it ends.
 */
export const TRACK_CAUTION = 70
export const TRACK_WARN = 85
export const TRACK_LIMIT = 100

/** Upgrade points awarded for surviving a wave / killing a boss. */
export const POINTS_PER_WAVE = 1
export const POINTS_PER_BOSS = 3

/**
 * Monster HP per wave: `HP_BASE * HP_GROWTH^(wave-1)`.
 *
 * HP_GROWTH is the difficulty dial. It decides which unit tier is strong
 * enough to clear, and therefore the clear rate. Tune it with `npm run sim`
 * against the paired target (heuristic ~20%, random ~0-2%).
 */
export const HP_BASE = 40
export const HP_GROWTH = 1.64

/**
 * Extra health on the opening waves, fading out by wave 11.
 *
 * The exponential curve is tuned so that waves 20-25 decide the run, which
 * leaves the opening as a formality: the board outgrows it within three waves
 * and monsters pop as they arrive. Measured peak on track over waves 1-9 was
 * 1.5 to 3 (`npm run waves`) — a queue, not a fight.
 *
 * Raising HP_BASE instead was tried and rejected. Because HP is
 * `BASE * GROWTH^(w-1)`, lifting the base lifts all thirty waves, and holding
 * wave 30 fixed by lowering GROWTH drags the whole midgame up with it — wave 20
 * got 60% tougher and the wave-5 boss went from a 14-second fight to a
 * 28-second one. The opening is the only part that needed changing, so this
 * touches only the opening.
 */
const EARLY_WAVES = 10
const EARLY_BOOST = 22

function earlyBoost(wave: number): number {
  if (wave > EARLY_WAVES) return 1
  // Front-loaded rather than linear or square-root.
  //
  // Square-root was right while auto-placement was handing the Archer slots it
  // could not shoot from: boards were weak throughout the opening, so a broad
  // boost suited. With that fixed, boards come up fast and only the first four
  // waves are thin — measured peak fell back to 2.0-2.9 there while waves 6-12
  // stayed at 4.5-6.6. An exponent above 1 concentrates the help where it is
  // still needed and leaves the rest alone.
  return 1 + EARLY_BOOST * Math.pow(1 - (wave - 1) / EARLY_WAVES, 1.5)
}

/**
 * What each wave is made of.
 *
 * This was seven patterns cycled by `(wave - 1) % 7`, which is a distribution,
 * not a design: the pressure landed wherever the modulo happened to put it.
 * Written out wave by wave instead, because the point of the size matrix is to
 * make "what should I roll next" a question, and that only works if the answer
 * changes at times the player can learn.
 *
 * The shape of the run:
 *
 *   1-4     teach. One size at a time, then two, so the matchups are learnable
 *           before anything punishes getting them wrong.
 *   6-9     the first walls. Wave 6 is all Small and wave 8 is all Large — the
 *           earliest point a single-class board finds out what it cannot kill.
 *   11-14   repeat the walls now that rosters are big enough to answer them.
 *   16-19   swings get sharper and sit next to each other.
 *   21-24   the real test, at the tier where the run is decided.
 *   26-29   the run-up: alternating walls, no safe band before the finale.
 *
 * Blocks are read against the boss that closes them. Wave 11 is Small-heavy
 * because the Broodmother at wave 10 has just left eight Small on the track;
 * wave 19 is all Large because the Warden at 20 is Large and caps every hit.
 *
 * A pattern is cycled to fill the wave's count, so the order here is also the
 * order they arrive in.
 */
const S = 'small'
const M = 'medium'
const L = 'large'

const COMPOSITION: readonly (readonly MonsterSize[])[] = [
  /*  1 */ [S],
  /*  2 */ [S, S, M],
  /*  3 */ [M],
  /*  4 */ [M, M, L],
  /*  5 */ [L], // boss
  /*  6 */ [S], //            all Small  — the Mage's floor
  /*  7 */ [S, M, L],
  /*  8 */ [L], //            all Large  — the Archer's floor
  /*  9 */ [S, S, S, M],
  /* 10 */ [L], // boss
  /* 11 */ [S, S, M], //      after eight Small from the Broodmother
  /* 12 */ [M, L],
  /* 13 */ [L], //            all Large
  /* 14 */ [S, M, M, L],
  /* 15 */ [S], // boss (the Shifter sets its own size)
  /* 16 */ [S], //            all Small
  /* 17 */ [L, L, M],
  /* 18 */ [S, M, L],
  /* 19 */ [L], //            all Large, into the Large boss at 20
  /* 20 */ [L], // boss
  /* 21 */ [S, S, M],
  /* 22 */ [L], //            all Large
  /* 23 */ [S, M, L],
  /* 24 */ [S], //            all Small
  /* 25 */ [L], // boss
  /* 26 */ [M, L, L],
  /* 27 */ [S, S, M, L],
  /* 28 */ [S], //            all Small
  /* 29 */ [L, L, M], //      the last breath before the Worldeater
  /* 30 */ [L], // boss
]

/**
 * Monster counts are the primary economy dial. Gold comes only from kills and
 * every monster is eventually killed, so:
 *
 *     total rolls = total monsters / ROLL_COST
 *
 * The 20% clear-rate target needs roughly 230 rolls, hence ~1,150 monsters.
 */
function buildWaves(): WaveDef[] {
  const waves: WaveDef[] = []
  for (let w = 1; w <= WAVE_COUNT; w++) {
    const boss = bossForWave(w)
    // The curve is what bosses are priced against; the boost is for trash only,
    // so the six boss fights stay exactly as long as they were tuned to be.
    const curve = HP_BASE * Math.pow(HP_GROWTH, w - 1)
    const trashHp = curve * earlyBoost(w)
    const trashSpeed = 46 + w * 0.6

    waves.push({
      wave: w,
      count: boss ? 1 : Math.round(15 + 2.2 * w),
      pattern: boss ? [boss.size] : COMPOSITION[w - 1],
      // Each boss's factor pays for its trait, so tougher traits carry less HP.
      hp: Math.round(boss ? curve * boss.hpFactor : trashHp),
      trashHp: Math.round(trashHp),
      speed: boss ? trashSpeed * boss.speedFactor : trashSpeed,
      boss: boss?.key ?? null,
    })
  }
  return waves
}

export const WAVES: readonly WaveDef[] = buildWaves()

export const TOTAL_MONSTERS = WAVES.reduce((sum, w) => sum + w.count, 0)

/** How many of each size a wave sends — what the HUD shows ahead of time. */
export function waveMix(wave: number): Record<MonsterSize, number> {
  const def = waveDef(wave)
  const mix: Record<MonsterSize, number> = { small: 0, medium: 0, large: 0 }
  for (let i = 0; i < def.count; i++) mix[def.pattern[i % def.pattern.length]]++
  return mix
}

export function waveDef(wave: number): WaveDef {
  return WAVES[Math.min(wave, WAVE_COUNT) - 1]
}
