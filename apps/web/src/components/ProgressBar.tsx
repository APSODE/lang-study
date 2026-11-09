// 가로 진행 막대. value 는 0–1 (범위를 넘으면 자른다).
export function ProgressBar({ value, label, thin = false }: { value: number; label?: string; thin?: boolean }) {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  return (
    <div
      className={`progress${thin ? ' thin' : ''}`}
      role={label ? 'progressbar' : undefined}
      aria-label={label}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
      aria-valuenow={label ? Math.round(v * 100) : undefined}
      aria-hidden={label ? undefined : true}
    >
      <div style={{ width: `${v * 100}%` }} />
    </div>
  )
}
