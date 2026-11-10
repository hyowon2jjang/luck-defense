import { Fragment, useState } from 'react'
import { FIELD_WIDTH } from '../core/data/board'
import { CLASSES, CLASS_IDS } from '../core/data/classes'
import { Portrait } from './Portrait'
import { useGame } from './useGame'
import type {
  ActiveGroup,
  ActiveUnit,
  BossStatus,
  Hud,
  NextWave,
  PendingReward,
  Reveal,
} from './useGame'

export function App() {
  const [seed, setSeed] = useState(1337)
  const {
    canvasRef,
    hud,
    active,
    reveal,
    group,
    speed,
    stats,
    resumed,
    muted,
    toggleMute,
    speedOptions,
    bestWave,
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
    pointer,
  } = useGame(seed)

  const newRun = () => {
    const next = (seed * 1664525 + 1013904223) >>> 0
    setSeed(next)
    reset(next)
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Luck Defense</h1>
        <span className="milestone">M3 — bosses &amp; rewards</span>
        {hud.boss && hud.phase === 'playing' && <BossBanner boss={hud.boss} />}
        {resumed && hud.phase === 'playing' && (
          <span className="resumed" title="Picked up where the last session left off">
            resumed
          </span>
        )}
        <div className="speeds" title="Keys 1–3, or space to cycle">
          {speedOptions.map((o) => (
            <button
              key={o.value}
              className={[
                'speed',
                o.value === speed ? 'active' : '',
                o.unlocked ? '' : 'locked',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={!o.unlocked}
              // A locked control that does not say why is just a broken one.
              title={
                o.unlocked
                  ? `${o.value}× speed`
                  : `Clear wave ${o.requires} to unlock — best so far: ${bestWave}`
              }
              onClick={() => setSpeed(o.value)}
            >
              {o.value}×{!o.unlocked && <em>W{o.requires}</em>}
            </button>
          ))}
        </div>
        <button
          className={muted ? 'mute muted' : 'mute'}
          title={muted ? 'Sound off' : 'Sound on'}
          onClick={toggleMute}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <span className="seed">seed {seed}</span>
      </header>

      <div className="layout">
        <aside className="panel inspector-panel">
          {hud.rewards.length > 0 && hud.phase === 'playing' && (
            <RewardCard
              reward={hud.rewards[0]}
              queued={hud.rewards.length - 1}
              onClaim={claimReward}
            />
          )}
          {group ? (
            <GroupCard
              group={group}
              onSellGroup={() => sellGroup(group.classId, group.tier)}
              onSellTier={() => sellTier(group.tier)}
              onClear={clearGroup}
            />
          ) : active ? (
            <UnitCard
              unit={active}
              refund={hud.sellRefund}
              gold={hud.gold}
              onSell={() => sellUnit(active.id)}
              onEnhance={() => enhanceUnit(active.id)}
            />
          ) : (
            <div className="placeholder">
              <h2>Unit</h2>
              <p className="empty">
                Click a unit to pin it here — it stays selected while you enhance or sell it.
                Click a roster row to select that whole group instead.
              </p>
            </div>
          )}
        </aside>

        <main className="stage">
          <canvas
            ref={canvasRef}
            // Handed to CSS as a variable rather than set as a fixed width, so
            // a media query can shrink the board without this overriding it.
            // The canvas keeps its own backing-store size either way, and
            // pointer coordinates are already scaled from the client rect.
            style={{ '--field': `${FIELD_WIDTH}px` } as React.CSSProperties}
            className={active?.holding ? 'field placing' : 'field'}
            {...pointer}
          />

          {reveal && <RollReveal reveal={reveal} />}

          {hud.finalTimer !== null && hud.phase === 'playing' && (
            <FinalCountdown seconds={hud.finalTimer} />
          )}

          {hud.phase !== 'playing' && (
            <div className="overlay">
              <p className={hud.phase === 'won' ? 'won' : 'lost'}>
                {hud.phase === 'won' ? 'Cleared' : 'Overrun'}
              </p>
              <p className="detail">
                Wave {hud.wave} · {hud.kills} kills
              </p>

              {/* The run just ended, which is the one moment a player is
                  actually curious how it compares to the others. */}
              <dl className="lifetime">
                <dt>Runs</dt>
                <dd>{stats.runs}</dd>
                <dt>Cleared</dt>
                <dd>
                  {stats.clears}
                  {stats.runs > 0 && (
                    <em> · {Math.round((stats.clears / stats.runs) * 100)}%</em>
                  )}
                </dd>
                <dt>Best wave</dt>
                <dd>{stats.bestWave}</dd>
                <dt>Total kills</dt>
                <dd>{stats.totalKills.toLocaleString()}</dd>
                <dt>Total rolls</dt>
                <dd>{stats.totalRolls.toLocaleString()}</dd>
              </dl>

              <button onClick={newRun}>New run</button>
            </div>
          )}
        </main>

        <aside className="panel">
          <ControlPanel hud={hud} send={send} group={group} selectGroup={selectGroup} />
        </aside>
      </div>
    </div>
  )
}

function UnitCard({
  unit,
  refund,
  gold,
  onSell,
  onEnhance,
}: {
  unit: ActiveUnit
  refund: number
  gold: number
  onSell: () => void
  onEnhance: () => void
}) {
  return (
    <div className="unit-card">
      <div className="unit-head">
        <Portrait classId={unit.classId} tier={unit.tier} />
        <div>
          <span className="unit-tier" style={{ color: unit.tierColor }}>
            {unit.tierName}
          </span>
          <h2 className="unit-name">{unit.name}</h2>
          <span className="type">
            {unit.className} · {unit.damageType}
          </span>
        </div>
      </div>

      <dl className="unit-stats">
        <Row label="DPS" value={compact(unit.dps)} />
        <Row label="Rate" value={`${unit.attacksPerSecond.toFixed(1)}/s`} />
        <Row label="Range" value={unit.range} />
        <Row label="Shots" value={unit.hits > 1 ? `${unit.hits} per volley` : 'single'} />
        {unit.splash > 0 && <Row label="Splash" value={`${Math.round(unit.splash)}px`} />}
        <Row label="Track reach" value={`${(unit.coverage * 100).toFixed(0)}%`} />
      </dl>

      {/* The tier that turns a single-target weapon into an area one is worth
          saying outright; it does not read off any of the numbers above. */}
      {unit.lineShare > 0 && (
        <p className="trait">
          Hits everything within {unit.range}px for{' '}
          <b>{Math.round(unit.lineShare * 100)}%</b>
        </p>
      )}

      <div className="matchups">
        {unit.vsSize.map((m) => (
          <div key={m.size} className={m.multiplier >= 1 ? 'matchup good' : 'matchup'}>
            <span>{m.size}</span>
            <b>{Math.round(m.multiplier * 100)}%</b>
          </div>
        ))}
      </div>

      <dl className="unit-stats record">
        <Row label="Kills" value={unit.kills.toLocaleString()} />
        <Row label="Damage" value={compact(unit.damage)} />
        <Row label="Recruited" value={`wave ${unit.recruitedOnWave}`} />
      </dl>

      {unit.enhance ? (
        <button
          className="enhance"
          disabled={gold < unit.enhance.cost}
          onClick={onEnhance}
        >
          <span>
            Enhance to <b style={{ color: unit.tierColor }}>{unit.enhance.nextName}</b>
          </span>
          <span className="odds">
            {Math.round(unit.enhance.chance * 100)}% · {unit.enhance.cost}g
          </span>
        </button>
      ) : (
        <p className="hint enhance-hint">{unit.enhanceHint}</p>
      )}

      <div className="unit-actions">
        <button className="sell" onClick={onSell}>
          Sell — +{refund}g
        </button>
      </div>
    </div>
  )
}

function GroupCard({
  group,
  onSellGroup,
  onSellTier,
  onClear,
}: {
  group: ActiveGroup
  onSellGroup: () => void
  onSellTier: () => void
  onClear: () => void
}) {
  const others = group.tierCount - group.count

  return (
    <div className="unit-card">
      <div className="unit-head">
        <Portrait classId={group.classId} tier={group.tier} />
        <div>
          <span className="unit-tier" style={{ color: group.tierColor }}>
            {group.tierName}
          </span>
          <h2 className="unit-name">{group.name}</h2>
          <span className="type">{group.count} selected</span>
        </div>
      </div>

      <dl className="unit-stats record">
        <Row label="Units" value={group.count} />
        <Row label="Kills" value={group.kills.toLocaleString()} />
        <Row label="Damage" value={compact(group.damage)} />
      </dl>

      <div className="unit-actions column">
        <button className="sell" onClick={onSellGroup}>
          Sell all {group.count} — +{group.refund}g
        </button>
        {others > 0 && (
          <button className="sell" onClick={onSellTier}>
            Sell every {group.tierName} ({group.tierCount}) — +{group.tierRefund}g
          </button>
        )}
        <button onClick={onClear}>Deselect</button>
      </div>
    </div>
  )
}

function RollReveal({ reveal }: { reveal: Reveal }) {
  // The nonce as key restarts the animation even on an identical result.
  return (
    <div
      key={reveal.nonce}
      className={`reveal rank-${reveal.kind === 'failed' ? 0 : reveal.rank} ${reveal.kind}`}
    >
      <span className="glow" style={{ background: reveal.tierColor }} />
      <Portrait classId={reveal.classId} tier={reveal.tier} size={44} />
      <div className="reveal-text">
        <span className="reveal-tier" style={{ color: reveal.tierColor }}>
          {reveal.kind === 'enhance' ? `Enhanced — ${reveal.tierName}` : reveal.tierName}
        </span>
        <strong>{reveal.name}</strong>
      </div>
    </div>
  )
}

/**
 * Names the boss and states its trait in one line.
 *
 * A trait the player has to infer from a health bar that will not move is just
 * an unexplained loss, so the tell is on screen for the whole fight — and the
 * shield and heal lamps show when it is actually costing them damage.
 *
 * It lives in the top bar rather than over the arena. As an overlay it covered
 * the corner of a board that is now square and, on a phone, full-bleed; up here
 * it costs the arena nothing and sits where the other run-wide readouts are.
 */
function BossBanner({ boss }: { boss: BossStatus }) {
  return (
    <div className="boss-banner">
      <div className="boss-line">
        <b style={{ color: boss.color }}>{boss.name}</b>
        {boss.size && <span className="lamp size">{boss.size}</span>}
        {boss.shielded && <span className="lamp shielded">shielded</span>}
        {boss.healing && <span className="lamp healing">healing</span>}
      </div>
      <span className="boss-tell">{boss.tell}</span>
      <div className="boss-bar">
        <span style={{ width: `${boss.fraction * 100}%`, background: boss.color }} />
      </div>
    </div>
  )
}

/**
 * The three-way boss reward.
 *
 * It waits in the left column, above the inspector, because it does not pause
 * the run — the wave clock never stops in this game. That column is empty
 * whenever no unit is pinned, which is most of the time, and the right-hand
 * panel is full of controls whose positions should not move under the cursor. The unit option is three buttons rather than
 * one, because which class carries the tier is the entire decision: a Myth in
 * the type you upgraded wins the run, the same tier in another class is 3 gold.
 */
function RewardCard({
  reward,
  queued,
  onClaim,
}: {
  reward: PendingReward
  queued: number
  onClaim: ReturnType<typeof useGame>['claimReward']
}) {
  return (
    <div className="reward-card">
      <header>
        <span className="reward-title">
          {reward.bossName} down — <b>take one</b>
        </span>
        {queued > 0 && <span className="pill">+{queued} waiting</span>}
      </header>

      <div className="reward-option">
        <span className="reward-label" style={{ color: reward.tierColor }}>
          {reward.tierName} unit — your pick
        </span>
        <div className="reward-classes">
          {reward.units.map((u) => (
            <button
              key={u.classId}
              disabled={reward.unitBlocked}
              title={reward.unitBlocked ? 'No room on the ring — sell something' : u.name}
              onClick={() => onClaim(reward.id, 'unit', u.classId)}
            >
              <Portrait classId={u.classId} tier={reward.tier} size={26} />
              <span>{u.className}</span>
            </button>
          ))}
        </div>
        {reward.unitBlocked && <p className="hint">Ring is full — sell to free a slot.</p>}
      </div>

      <div className="reward-split">
        <button onClick={() => onClaim(reward.id, 'points')}>
          +{reward.points} <em>upgrade pts</em>
        </button>
        <button onClick={() => onClaim(reward.id, 'gold')}>
          +{reward.gold} <em>gold</em>
        </button>
      </div>
    </div>
  )
}

function FinalCountdown({ seconds }: { seconds: number }) {
  const clamped = Math.max(0, seconds)
  const mm = Math.floor(clamped / 60)
  const ss = Math.floor(clamped % 60)
  return (
    <div className={clamped <= 30 ? 'countdown urgent' : 'countdown'}>
      <span>Final boss</span>
      <b>
        {mm}:{String(ss).padStart(2, '0')}
      </b>
    </div>
  )
}

function ControlPanel({
  hud,
  send,
  group,
  selectGroup,
}: {
  hud: Hud
  send: ReturnType<typeof useGame>['send']
  group: ActiveGroup | null
  selectGroup: ReturnType<typeof useGame>['selectGroup']
}) {
  return (
    <>
      <section className="stats">
        <Stat label="Wave" value={`${hud.wave} / ${hud.waveCount}`} />
        <div className="stat next">
          <span className="stat-label">Next</span>
          <span className="stat-value">{hud.waveTimer.toFixed(1)}s</span>
          <button
            className={hud.skipBounty > 0 ? 'skip paying' : 'skip'}
            disabled={!hud.canSkip}
            title={
              hud.spawning
                ? 'The wave is still arriving'
                : 'Call the next wave now — paid for the clock you give up'
            }
            onClick={() => send({ kind: 'skip' })}
          >
            {hud.skipBounty > 0 ? `Skip +${hud.skipBounty}g` : 'Skip'}
          </button>
        </div>
        <Stat label="Gold" value={hud.gold} />
        <Stat label="Points" value={hud.points} />
        <Stat
          label="On track"
          value={`${hud.monsters} / ${hud.trackLimit}`}
          level={hud.warning ? 'alert' : hud.caution ? 'caution' : undefined}
        />
        <Stat
          label="Units"
          value={`${hud.fielded} / ${hud.capacity}`}
          level={hud.full ? 'alert' : undefined}
        />
      </section>

      {hud.nextWave && <NextWaveStrip next={hud.nextWave} />}

      {hud.warning ? (
        <p className="alarm">
          Track saturating — {hud.trackLimit - hud.monsters} before the run ends.
        </p>
      ) : (
        hud.caution && (
          <p className="alarm caution">
            Track filling — {hud.trackLimit - hud.monsters} left. Skip pays well
            right now.
          </p>
        )
      )}

      <section>
        <h2>Recruit</h2>
        <button
          className="primary"
          disabled={hud.full || hud.gold < hud.rollCost || hud.phase !== 'playing'}
          onClick={() => send({ kind: 'roll' })}
        >
          Roll — {hud.rollCost}g
        </button>
        {hud.full && (
          <p className="alarm">Ring is full — sell a unit to recruit another.</p>
        )}
      </section>

      <section>
        <h2>
          Upgrades <span className="pill">{hud.points} pts</span>
        </h2>
        <div className="upgrades">
          {hud.upgrades.map((u) => (
            <button
              key={u.damageType}
              disabled={hud.points < 1 || hud.phase !== 'playing'}
              onClick={() => send({ kind: 'upgrade', damageType: u.damageType })}
            >
              <span>
                {u.label} <em>Lv {u.level}</em>
              </span>
              <span className="cost">×{formatMultiplier(u.multiplier)}</span>
            </button>
          ))}
        </div>
        <p className="hint">No refunds — bank until you know your build.</p>
      </section>

      <RosterGrid hud={hud} group={group} selectGroup={selectGroup} />

      <details className="tier-table">
        <summary>Roll odds &amp; enhance costs</summary>
        <table>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Roll</th>
              <th>Damage</th>
              <th>Rate</th>
              <th>Enhance</th>
            </tr>
          </thead>
          <tbody>
            {hud.tierTable.map((t) => (
              <tr key={t.key}>
                <td style={{ color: t.color }}>{t.name}</td>
                <td>{formatRate(t.probability)}</td>
                <td>×{t.damageMultiplier.toLocaleString()}</td>
                <td>×{t.attackSpeed.toFixed(2)}</td>
                <td>
                  {t.enhanceCost === null ? (
                    <span className="muted">—</span>
                  ) : (
                    `${Math.round(t.enhanceChance * 100)}% · ${t.enhanceCost}g`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  )
}

/**
 * What is coming, one wave ahead.
 *
 * The composition table is designed, not random — all-Small waves punish a
 * Blast board, all-Large punish Pierce — but a schedule nobody can see is
 * indistinguishable from variance. This is the half that makes it a decision:
 * it is read before spending gold, not after losing to it.
 */
function NextWaveStrip({ next }: { next: NextWave }) {
  return (
    <section className="next-wave">
      <h2>
        Wave {next.wave} incoming
        {next.boss && <span className="pill boss-pill">{next.boss}</span>}
      </h2>
      <div className="mix">
        {next.counts.map((c) => (
          <span key={c.size} className={`mix-${c.size}`}>
            <i /> {c.count} {c.size}
          </span>
        ))}
      </div>
    </section>
  )
}

/**
 * The roster as a tier x class grid rather than a list.
 *
 * A list grows a row per combination — up to twenty-four — so it either scrolled
 * or pushed everything below it off the screen. The grid is the same data in a
 * fixed shape, and it is the shape the game already thinks in: colour down the
 * side is rank, the three columns are the classes.
 *
 * Empty tiers are dropped. Showing all eight would be steadier to aim at, but
 * most of a run only ever holds three or four, and the vertical space is the
 * whole point of the exercise.
 */
function RosterGrid({
  hud,
  group,
  selectGroup,
}: {
  hud: Hud
  group: ActiveGroup | null
  selectGroup: ReturnType<typeof useGame>['selectGroup']
}) {
  const cells = new Map(hud.groups.map((g) => [`${g.classId}:${g.tier}`, g]))
  const rows = hud.tierTable.filter((t) =>
    CLASS_IDS.some((c) => cells.has(`${c}:${t.key}`)),
  )

  return (
    <section className="roster">
      <h2>
        Roster <span className="pill">{hud.fielded}</span>
      </h2>

      {rows.length === 0 ? (
        <p className="empty">Roll to recruit your first unit.</p>
      ) : (
        <div className="roster-grid">
          <span />
          {CLASS_IDS.map((c) => (
            <span key={c} className="col-head" title={CLASSES[c].name}>
              {CLASSES[c].name[0]}
            </span>
          ))}

          {rows.map((t) => (
            <Fragment key={t.key}>
              <span className="row-head" style={{ color: t.color }}>
                {t.name}
              </span>
              {CLASS_IDS.map((c) => {
                const cell = cells.get(`${c}:${t.key}`)
                const selected = group?.classId === c && group?.tier === t.key
                if (!cell) return <span key={c} className="cell empty-cell" />
                return (
                  <button
                    key={c}
                    className={selected ? 'cell selected' : 'cell'}
                    style={{ borderColor: t.color }}
                    title={`${cell.name} ×${cell.count}`}
                    onClick={() => selectGroup(c, t.key)}
                  >
                    {cell.count}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  )
}

function formatRate(p: number): string {
  const pct = p * 100
  if (pct >= 10) return `${pct.toFixed(1)}%`
  if (pct >= 1) return `${pct.toFixed(1)}%`
  if (pct >= 0.1) return `${pct.toFixed(2)}%`
  return `${pct.toFixed(3)}%`
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

function compact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return Math.round(value).toString()
}

function formatMultiplier(value: number): string {
  if (value >= 100) return Math.round(value).toLocaleString()
  return value.toFixed(1)
}

function Stat({
  label,
  value,
  level,
}: {
  label: string
  value: string | number
  level?: 'caution' | 'alert'
}) {
  return (
    <div className={level ? `stat ${level}` : 'stat'}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}
