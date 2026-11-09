// 비어 있음 · 준비 중 · 오류 안내. 아이콘 + 제목 + 설명 + (선택) 버튼.
import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon.tsx'

export function EmptyState({
  icon = 'inbox',
  title,
  children,
  action,
}: {
  icon?: IconName
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

/**
 * useApi 결과의 실패를 보여 준다. 404 는 서버에 아직 API 가 없다는 뜻이라 "준비 중"으로,
 * 그 밖의 오류는 메시지와 다시 시도 버튼으로.
 */
export function LoadError({
  error,
  notReady,
  onRetry,
}: {
  error: { message: string } | null
  notReady: boolean
  onRetry: () => void
}) {
  if (notReady) {
    return (
      <EmptyState icon="inbox" title="준비 중">
        서버에서 아직 준비 중인 기능입니다. 곧 열려요.
      </EmptyState>
    )
  }
  return (
    <EmptyState
      icon="inbox"
      title="불러오지 못했습니다"
      action={
        <button type="button" className="secondary" onClick={onRetry}>
          다시 시도
        </button>
      }
    >
      {error?.message}
    </EmptyState>
  )
}
