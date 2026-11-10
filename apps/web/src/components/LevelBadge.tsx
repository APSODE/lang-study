// 레벨 배지 "Lv 7" (순위 · 친구). title 을 주면 마우스를 올렸을 때 칭호가 보인다.
export function LevelBadge({ level, title }: { level: number; title?: string }) {
  return (
    <span className="lv-badge" title={title}>
      Lv {level}
    </span>
  )
}
