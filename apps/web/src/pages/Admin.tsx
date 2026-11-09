// 관리 (#/admin/invites · #/admin/reports · #/admin/users). 관리자만 (App 이 막는다).
import { Segmented } from '../components/Segmented.tsx'
import { AdminInvites } from './AdminInvites.tsx'
import { AdminReports } from './AdminReports.tsx'
import { AdminUsers } from './AdminUsers.tsx'

export type AdminTab = 'invites' | 'reports' | 'users'

export function Admin({ tab }: { tab: AdminTab }) {
  return (
    <div className="page admin-page">
      <Segmented
        label="관리 메뉴"
        value={tab}
        items={[
          { value: 'invites', label: '초대', href: '#/admin/invites' },
          { value: 'reports', label: '신고', href: '#/admin/reports' },
          { value: 'users', label: '사용자', href: '#/admin/users' },
        ]}
      />
      {tab === 'invites' && <AdminInvites />}
      {tab === 'reports' && <AdminReports />}
      {tab === 'users' && <AdminUsers />}
    </div>
  )
}
