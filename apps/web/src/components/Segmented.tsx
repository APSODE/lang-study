// 탭처럼 쓰는 묶음 버튼 (이번 주 / 이번 달, 히라가나 / 가타카나 등). href 를 주면 링크로 만든다.
export interface SegmentItem<T extends string> {
  value: T
  label: string
  href?: string
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: SegmentItem<T>[]
  value: T
  onChange?: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {items.map(it =>
        it.href ? (
          <a key={it.value} href={it.href} role="tab" aria-selected={it.value === value} className={it.value === value ? 'on' : ''}>
            {it.label}
          </a>
        ) : (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={it.value === value}
            className={it.value === value ? 'on' : ''}
            onClick={() => onChange?.(it.value)}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  )
}
