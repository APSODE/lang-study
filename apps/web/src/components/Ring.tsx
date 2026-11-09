// SVG 진행 고리. value 는 0–1. 가운데에 children 을 둔다.
import type { ReactNode } from 'react'

export function Ring({
  value,
  size = 120,
  stroke = 10,
  label,
  children,
}: {
  value: number
  size?: number
  stroke?: number
  label: string
  children?: ReactNode
}) {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        {v > 0 && (
          <circle
            className="ring-value"
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      {children && <div className="ring-center">{children}</div>}
    </div>
  )
}
