/**
 * All sound, synthesised. No audio files ship with the game.
 *
 * The same reasoning as the artwork: a downloaded sample pack would fight the
 * look, and these are short percussive noises that an oscillator and a noise
 * burst make convincingly. It also means a new sound costs a function, not an
 * asset pipeline.
 *
 * The hard constraint is rate. At 3x with a full ring the game lands over a
 * thousand hits a second, so a sound per hit is not a mixing problem, it is a
 * crash. Every voice here goes through `throttle`, which collapses a burst into
 * one sound and lets the louder events (a death, a boss) cut ahead of chip
 * damage. The caller passes counts, not events, for the same reason.
 *
 * Everything is wrapped defensively — audio is never allowed to break a run.
 */
let ctx: AudioContext | null = null
let master: GainNode | null = null
let muted = false

function audio(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = 0.5
    master.connect(ctx.destination)
  } catch {
    return null
  }
  return ctx
}

export function setMuted(next: boolean): void {
  muted = next
  if (master) master.gain.value = next ? 0 : 0.5
}

export function isMuted(): boolean {
  return muted
}

/** Minimum seconds between two plays of the same voice. */
const lastPlayed = new Map<string, number>()

function throttle(key: string, gap: number): boolean {
  const ac = audio()
  if (!ac || muted) return false
  const now = ac.currentTime
  const last = lastPlayed.get(key)
  if (last !== undefined && now - last < gap) return false
  lastPlayed.set(key, now)
  // Browsers suspend the context until a gesture; resume on first real sound.
  if (ac.state === 'suspended') void ac.resume()
  return true
}

/** A short burst of filtered noise — impacts, thuds, debris. */
function noise(
  ac: AudioContext,
  { at = 0, length = 0.1, gain = 0.2, freq = 1200, q = 1, type = 'bandpass' as BiquadFilterType },
): void {
  const frames = Math.max(1, Math.floor(ac.sampleRate * length))
  const buffer = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    // Decaying white noise. The envelope is baked in so one node does the job.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2
  }

  const src = ac.createBufferSource()
  src.buffer = buffer

  const filter = ac.createBiquadFilter()
  filter.type = type
  filter.frequency.value = freq
  filter.Q.value = q

  const vol = ac.createGain()
  vol.gain.value = gain

  src.connect(filter).connect(vol).connect(master!)
  src.start(ac.currentTime + at)
}

/** A pitched blip, optionally sweeping. */
type ToneOpts = {
  at?: number
  from?: number
  /** Defaults to `from`, i.e. a flat note. */
  to?: number
  length?: number
  gain?: number
  type?: OscillatorType
}

function tone(ac: AudioContext, opts: ToneOpts): void {
  const { at = 0, from = 440, to = from, length = 0.12, gain = 0.14, type = 'sine' } = opts
  const t = ac.currentTime + at
  const osc = ac.createOscillator()
  const vol = ac.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + length)

  vol.gain.setValueAtTime(0.0001, t)
  vol.gain.exponentialRampToValueAtTime(gain, t + 0.008)
  vol.gain.exponentialRampToValueAtTime(0.0001, t + length)

  osc.connect(vol).connect(master!)
  osc.start(t)
  osc.stop(t + length + 0.02)
}

/**
 * Impacts, one voice per damage type.
 *
 * `count` is how many landed this frame. It only raises the volume a little —
 * forty arrows should sound busier than one, not forty times louder.
 */
export function playHits(type: 'pierce' | 'balanced' | 'blast', count: number): void {
  if (count <= 0) return
  const swell = Math.min(1, 0.45 + count * 0.12)

  if (type === 'pierce') {
    // Arrows: tight, dry, high. Allowed to repeat fastest — it is the Archer's
    // whole identity that there are a lot of them.
    if (!throttle('pierce', 0.055)) return
    noise(ctx!, { length: 0.05, gain: 0.05 * swell, freq: 3200, q: 1.4 })
    return
  }

  if (type === 'balanced') {
    // Shuriken: a metallic tick.
    if (!throttle('balanced', 0.08)) return
    noise(ctx!, { length: 0.06, gain: 0.05 * swell, freq: 5200, q: 3 })
    tone(ctx!, { from: 2100, to: 1500, length: 0.05, gain: 0.03 * swell, type: 'square' })
    return
  }

  // Blast: low body with a short tail. The only impact with weight.
  if (!throttle('blast', 0.13)) return
  noise(ctx!, { length: 0.22, gain: 0.1 * swell, freq: 320, q: 0.7, type: 'lowpass' })
  tone(ctx!, { from: 160, to: 42, length: 0.26, gain: 0.12 * swell, type: 'sine' })
}

/** The top-tier line sweep: a rising shimmer over the impact. */
export function playWave(count: number): void {
  if (count <= 0 || !throttle('wave', 0.25)) return
  tone(ctx!, { from: 700, to: 1900, length: 0.3, gain: 0.07, type: 'triangle' })
  noise(ctx!, { length: 0.3, gain: 0.04, freq: 2600, q: 0.8 })
}

export function playDeaths(count: number): void {
  if (count <= 0 || !throttle('death', 0.1)) return
  noise(ctx!, { length: 0.1, gain: 0.05 + Math.min(0.05, count * 0.01), freq: 700, q: 0.9 })
}

/** A boss dying is the loudest thing in the game and never gets throttled out. */
export function playBossDeath(): void {
  if (!throttle('bossDeath', 0.4)) return
  noise(ctx!, { length: 0.7, gain: 0.26, freq: 220, q: 0.5, type: 'lowpass' })
  tone(ctx!, { from: 300, to: 38, length: 0.8, gain: 0.22, type: 'sawtooth' })
  tone(ctx!, { at: 0.06, from: 150, to: 30, length: 0.7, gain: 0.16, type: 'sine' })
}

export function playBossSpawn(): void {
  if (!throttle('bossSpawn', 1)) return
  tone(ctx!, { from: 60, to: 150, length: 0.55, gain: 0.18, type: 'sawtooth' })
  tone(ctx!, { at: 0.1, from: 120, to: 300, length: 0.45, gain: 0.1, type: 'triangle' })
}

/** Wave rollover: a small two-note nudge, easy to ignore after thirty of them. */
export function playWaveStart(): void {
  if (!throttle('waveStart', 0.5)) return
  tone(ctx!, { from: 520, length: 0.09, gain: 0.07, type: 'triangle' })
  tone(ctx!, { at: 0.1, from: 780, length: 0.12, gain: 0.07, type: 'triangle' })
}

/** The 85-monster line. Deliberately unpleasant, and slow enough to not nag. */
export function playWarning(): void {
  if (!throttle('warning', 2.5)) return
  tone(ctx!, { from: 300, to: 190, length: 0.3, gain: 0.1, type: 'sawtooth' })
  tone(ctx!, { at: 0.26, from: 300, to: 180, length: 0.34, gain: 0.1, type: 'sawtooth' })
}

export function playReward(): void {
  if (!throttle('reward', 0.4)) return
  for (let i = 0; i < 3; i++) {
    tone(ctx!, { at: i * 0.07, from: 520 * Math.pow(2, i / 4), length: 0.22, gain: 0.08, type: 'triangle' })
  }
}

/** Rising major arpeggio; higher tiers get more notes and a brighter timbre. */
const SCALE = [0, 4, 7, 12, 16, 19, 24, 28]

export function playRoll(tierIndex: number): void {
  if (!throttle('roll', 0.04)) return
  const ac = ctx!
  const notes = Math.min(1 + Math.floor(tierIndex / 2), 5)
  const bright = tierIndex >= 4

  for (let i = 0; i < notes; i++) {
    tone(ac, {
      at: i * 0.065,
      from: 330 * Math.pow(2, (SCALE[tierIndex] + i * 5) / 12),
      length: 0.3,
      gain: bright ? 0.14 : 0.07,
      type: bright ? 'triangle' : 'sine',
    })
  }
}
