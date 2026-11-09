// 카드: 화면의 기본 상자. title 을 주면 머리글(제목 + 오른쪽 action)을 단다.
import type { ReactNode } from 'react'

export function Card({
  title,
  action,
  className = '',
  children,
}: {
  title?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || action) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}
