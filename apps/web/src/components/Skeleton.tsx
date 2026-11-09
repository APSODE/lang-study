// 불러오는 동안 자리를 잡아 두는 회색 막대. 화면 읽기 프로그램에는 "불러오는 중"만 알린다.
export function Skeleton({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton-group" role="status" aria-label="불러오는 중">
      {height !== undefined ? (
        <div className="skeleton" style={{ height }} />
      ) : (
        Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton line" style={{ width: `${90 - (i % 3) * 20}%` }} />)
      )}
    </div>
  )
}
