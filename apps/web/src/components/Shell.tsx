// 앱 껍데기: 휴대폰(< 768px)은 위 막대 + 아래 탭 막대, 넓은 화면은 왼쪽 사이드바 + 위 막대.
// 어느 쪽을 보일지는 CSS(style.css "껍데기")가 정한다. 둘 다 같은 NAV 목록을 쓴다.
// 오늘 학습 요약(study/summary)은 App 이 불러와 SummaryContext 로 내려 준다(🔥 연속 학습일, 홈 화면).
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { api, type SessionUser } from '../api.ts'
import type { ApiState } from '../hooks.ts'
import type { StudySummary } from '../types.ts'
import { Icon, type IconName } from './Icon.tsx'

export const SummaryContext = createContext<ApiState<StudySummary> | null>(null)

export const useSummary = (): ApiState<StudySummary> => {
  const s = useContext(SummaryContext)
  if (!s) throw new Error('SummaryContext 밖에서 useSummary 를 불렀습니다')
  return s
}

interface NavItem {
  href: string
  label: string
  icon: IconName
  match: (route: string) => boolean
}

export const NAV: NavItem[] = [
  { href: '#/', label: '홈', icon: 'home', match: r => r === '/' },
  { href: '#/stats', label: '기록', icon: 'stats', match: r => r.startsWith('/stats') },
  { href: '#/friends', label: '친구', icon: 'friends', match: r => r.startsWith('/friends') },
  { href: '#/library', label: '자료', icon: 'library', match: r => r.startsWith('/library') || r === '/kana' },
  { href: '#/settings', label: '설정', icon: 'settings', match: r => r.startsWith('/settings') },
]

const ADMIN_NAV: NavItem = { href: '#/admin', label: '관리', icon: 'admin', match: r => r.startsWith('/admin') }

const logout = async (onLogout: () => void) => {
  await api('auth/logout', { method: 'POST' }).catch(() => undefined)
  onLogout()
}

function StreakChip() {
  const { data } = useSummary()
  if (!data) return null
  return (
    <a className="chip streak-chip" href="#/stats" aria-label={`연속 학습 ${data.streak}일`}>
      <span aria-hidden="true">🔥</span>
      {data.streak}
    </a>
  )
}

/** 휴대폰용 사용자 메뉴 (넓은 화면에서는 사이드바 아래에 같은 내용이 있어 CSS 로 숨긴다) */
function UserMenu({ user, route, onLogout }: { user: SessionUser; route: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setOpen(false), [route])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="icon-btn avatar"
        aria-label="내 메뉴"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="menu" role="menu">
          <p className="menu-name">
            <strong>{user.name}</strong>
            {user.isAdmin && <span className="badge">관리자</span>}
          </p>
          {user.isAdmin && (
            <a role="menuitem" href={ADMIN_NAV.href}>
              <Icon name="admin" size={20} />
              관리
            </a>
          )}
          <a role="menuitem" href="#/settings">
            <Icon name="settings" size={20} />
            설정
          </a>
          <button type="button" role="menuitem" onClick={() => void logout(onLogout)}>
            <Icon name="logout" size={20} />
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}

export function Shell({
  user,
  route,
  title,
  onLogout,
  children,
}: {
  user: SessionUser
  route: string
  title: string
  onLogout: () => void
  children: ReactNode
}) {
  const side = user.isAdmin ? [...NAV, ADMIN_NAV] : NAV
  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#content"
        onClick={e => {
          // 해시 라우팅이라 #content 로 이동하면 경로가 바뀐다 — 초점만 옮긴다
          e.preventDefault()
          document.getElementById('content')?.focus()
        }}
      >
        본문으로 건너뛰기
      </a>

      <nav className="sidebar" aria-label="주 메뉴">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true">
            中
          </span>
          NakamuraProject
        </a>
        <ul className="side-nav">
          {side.map(it => (
            <li key={it.href}>
              <a href={it.href} aria-current={it.match(route) ? 'page' : undefined}>
                <Icon name={it.icon} />
                {it.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="side-user">
          <span className="avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="side-user-name">
            <strong>{user.name}</strong>
            {user.isAdmin && <span className="muted small">관리자</span>}
          </span>
          <button type="button" className="icon-btn" aria-label="로그아웃" title="로그아웃" onClick={() => void logout(onLogout)}>
            <Icon name="logout" size={20} />
          </button>
        </div>
      </nav>

      <div className="shell-main">
        <header className="appbar">
          <h1 className="appbar-title">{title}</h1>
          <div className="appbar-actions">
            <StreakChip />
            <UserMenu user={user} route={route} onLogout={onLogout} />
          </div>
        </header>
        <main className="content" id="content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className="tabbar" aria-label="주 메뉴">
        {NAV.map(it => (
          <a key={it.href} href={it.href} aria-current={it.match(route) ? 'page' : undefined}>
            <Icon name={it.icon} />
            <span>{it.label}</span>
          </a>
        ))}
      </nav>
    </div>
  )
}
