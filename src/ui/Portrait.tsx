import { CLASSES } from '../core/data/classes'
import { TIER_BY_KEY } from '../core/data/tiers'
import type { ClassId, TierKey } from '../core/types'

/**
 * Generated unit portrait: a class emblem on a tier-coloured plate.
 *
 * Drawn rather than illustrated so every one of the 24 unit combinations has
 * artwork without commissioning any. Real art can replace this wholesale.
 */
export function Portrait({
  classId,
  tier,
  size = 72,
}: {
  classId: ClassId
  tier: TierKey
  size?: number
}) {
  const def = CLASSES[classId]
  const tierColor = TIER_BY_KEY[tier].color
  const gradientId = `plate-${classId}-${tier}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`${def.name}, ${TIER_BY_KEY[tier].name}`}
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="34%" r="70%">
          <stop offset="0%" stopColor={def.color} stopOpacity="0.42" />
          <stop offset="100%" stopColor={def.color} stopOpacity="0.06" />
        </radialGradient>
      </defs>

      <rect x="2" y="2" width="60" height="60" rx="12" fill="#0b0f18" />
      <rect x="2" y="2" width="60" height="60" rx="12" fill={`url(#${gradientId})`} />
      <rect
        x="3.5"
        y="3.5"
        width="57"
        height="57"
        rx="10.5"
        fill="none"
        stroke={tierColor}
        strokeWidth="2.5"
      />

      <Emblem classId={classId} color={def.color} />
    </svg>
  )
}

function Emblem({ classId, color }: { classId: ClassId; color: string }) {
  if (classId === 'archer') {
    // Drawn bow with a nocked arrow.
    return (
      <g stroke={color} strokeWidth="2.6" fill="none" strokeLinecap="round">
        <path d="M24 14 A 20 20 0 0 1 24 50" />
        <path d="M24 14 L 24 50" strokeWidth="1.6" />
        <path d="M22 32 L 46 32" />
        <path d="M40 27 L 46 32 L 40 37" />
      </g>
    )
  }

  if (classId === 'mage') {
    // Orb over a casting circle.
    return (
      <g stroke={color} fill="none" strokeLinecap="round">
        <circle cx="32" cy="27" r="9" strokeWidth="2.6" fill={color} fillOpacity="0.28" />
        <path d="M16 44 Q 32 36 48 44" strokeWidth="2.6" />
        <path d="M18 49 Q 32 42 46 49" strokeWidth="1.6" strokeOpacity="0.6" />
        <path d="M32 10 L 32 15 M20 15 L 23 19 M44 15 L 41 19" strokeWidth="2" />
      </g>
    )
  }

  // Ninja: four-point shuriken.
  return (
    <g stroke={color} strokeWidth="2.6" strokeLinejoin="round" fill={color} fillOpacity="0.2">
      <path d="M32 12 L 38 26 L 52 32 L 38 38 L 32 52 L 26 38 L 12 32 L 26 26 Z" />
      <circle cx="32" cy="32" r="3.4" fill="#0b0f18" />
    </g>
  )
}
