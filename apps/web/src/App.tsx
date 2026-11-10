import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { isTrack } from '@nakamura/core'
import { api, type SessionUser } from './api.ts'
import { Shell, SummaryContext } from './components/Shell.tsx'
import { useApi } from './hooks.ts'
import { Admin, type AdminTab } from './pages/Admin.tsx'
import { Friends } from './pages/Friends.tsx'
import { Home } from './pages/Home.tsx'
import { Join } from './pages/Join.tsx'
import { KanaChart } from './pages/KanaChart.tsx'
import { KanjiList } from './pages/KanjiList.tsx'
import { Library } from './pages/Library.tsx'
import { Login } from './pages/Login.tsx'
import { Settings } from './pages/Settings.tsx'
import { Stats } from './pages/Stats.tsx'
import { Study } from './pages/Study.tsx'
import { Redirect, useRoute } from './router.ts'
import type { StudySummary } from './types.ts'

// 앱 껍데기: 로그인 상태(/api/auth/me)를 불러오고 해시 경로에 맞는 화면을 고른다.
// 경로: #/ · #/stats · #/friends · #/library(/kana|/kanji) · #/settings · #/admin(/invites|/reports|/users)
//       #/study/<트랙> (껍데기 없이 집중 모드) · #/login · #/join/<code>. 예전 #/kana 는 #/library/kana 로 보낸다.
export function App() {
  const route = useRoute()
  // undefined = 확인 중, null = 로그인 안 됨
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined)
  const [loadError, setLoadError] = useState('')

  const loadMe = useCallback(() => {
    setLoadError('')
    api<{ user: SessionUser | null }>('auth/me')
      .then(r => setUser(r.user))
      .catch(err => setLoadError((err as Error).message))
  }, [])

  useEffect(loadMe, [loadMe])

  // 오늘 요약(🔥 연속 학습일 · 홈). 화면을 옮길 때마다(특히 학습을 마치고 돌아올 때) 새로 받는다.
  const summary = useApi<StudySummary>(user ? 'study/summary' : null)
  const prevRoute = useRef(route)
  const { reload } = summary
  useEffect(() => {
    if (prevRoute.current === route) return
    prevRoute.current = route
    if (!route.startsWith('/study/')) reload()
  }, [route, reload])

  if (user === undefined) {
    return (
      <main>
        <h1>NakamuraProject</h1>
        {loadError ? (
          <>
            <p className="error">{loadError}</p>
            <button type="button" onClick={loadMe}>
              다시 시도
            </button>
          </>
        ) : (
          <p className="muted">불러오는 중…</p>
        )}
      </main>
    )
  }

  const join = route.match(/^\/join\/([^/]+)$/)
  if (join) {
    if (user) return <Redirect to="/" />
    return <Join code={decodeURIComponent(join[1]!)} onLogin={setUser} />
  }
  if (route === '/login') return user ? <Redirect to="/" /> : <Login onLogin={setUser} />
  if (!user) return <Redirect to="/login" />

  // 학습은 집중 모드: 탭 막대 · 사이드바 없이 화면 전체를 쓴다
  const study = route.match(/^\/study\/([^/]+)$/)
  if (study) return isTrack(study[1]) ? <Study key={study[1]} track={study[1]} /> : <Redirect to="/" />

  const shell = (title: string, page: ReactNode) => (
    <SummaryContext.Provider value={summary}>
      <Shell user={user} route={route} title={title} onLogout={() => setUser(null)}>
        {page}
      </Shell>
    </SummaryContext.Provider>
  )

  switch (route) {
    case '/':
      return shell('홈', <Home user={user} />)
    case '/stats':
      return shell('기록', <Stats />)
    case '/friends':
      return shell('친구', <Friends user={user} />)
    case '/library':
      return shell('자료', <Library />)
    case '/library/kana':
      return shell('50음도', <KanaChart />)
    case '/library/kanji':
      return shell('한자 목록', <KanjiList />)
    case '/kana':
      return <Redirect to="/library/kana" />
    case '/settings':
      return shell('설정', <Settings user={user} onLogout={() => setUser(null)} onUserChange={setUser} />)
  }

  const admin = route.match(/^\/admin(?:\/(invites|reports|users))?$/)
  if (admin) {
    if (!user.isAdmin) return <Redirect to="/" />
    if (!admin[1]) return <Redirect to="/admin/invites" />
    return shell('관리', <Admin tab={admin[1] as AdminTab} />)
  }
  return <Redirect to="/" />
}
