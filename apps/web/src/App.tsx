import { useCallback, useEffect, useState } from 'react'
import { api, type SessionUser } from './api.ts'
import { AdminInvites } from './pages/AdminInvites.tsx'
import { Home } from './pages/Home.tsx'
import { Join } from './pages/Join.tsx'
import { Login } from './pages/Login.tsx'
import { Redirect, useRoute } from './router.ts'

// 앱 껍데기: 로그인 상태(/api/auth/me)를 불러오고 해시 경로에 맞는 화면을 고른다.
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
  if (route === '/admin/invites') return user.isAdmin ? <AdminInvites /> : <Redirect to="/" />
  if (route === '/') return <Home user={user} onLogout={() => setUser(null)} />
  return <Redirect to="/" />
}
