// 큰 숫자 + 설명. 통계 줄(.stats-row)에 여러 개를 나란히 둔다.
import type { ReactNode } from 'react'

export function Stat({ value, label, sub }: { value: ReactNode; label: string; sub?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}
