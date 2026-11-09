// 관리 · 사용자 (#/admin/users): 이름 · 관리자 · 마지막 학습 · 이번 주 복습 · 진도 공개.
import { LoadError } from '../components/EmptyState.tsx'
import { useSummary } from '../components/Shell.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { fmtDate, fmtNum, localToday, relativeDay } from '../format.ts'
import { useApi } from '../hooks.ts'
import type { AdminUsersResponse } from '../types.ts'

export function AdminUsers() {
  const users = useApi<AdminUsersResponse>('admin/users')
  const today = useSummary().data?.day ?? localToday()

  if (!users.data) {
    return users.error ? (
      <LoadError error={users.error} notReady={users.notReady} onRetry={users.reload} />
    ) : (
      <Skeleton lines={4} />
    )
  }
  return (
    <section className="admin-section">
      <p className="muted small">사용자 {fmtNum(users.data.users.length)}명</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">마지막 학습</th>
              <th scope="col" className="num">
                이번 주
              </th>
              <th scope="col">공개</th>
            </tr>
          </thead>
          <tbody>
            {users.data.users.map(u => (
              <tr key={u.id}>
                <th scope="row">
                  <span className="cell-name">
                    {u.name}
                    {u.isAdmin && <span className="badge">관리자</span>}
                  </span>
                  <span className="muted small block">가입 {fmtDate(u.createdAt)}</span>
                </th>
                <td>{relativeDay(u.lastStudiedDay, today)}</td>
                <td className="num">{fmtNum(u.reviewsWeek)}</td>
                <td>{u.showProgress ? '공개' : <span className="muted">비공개</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
