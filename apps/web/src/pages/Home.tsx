import { useEffect, useState } from 'react'
import { DEFAULT_NEW_PER_DAY, TRACKS, type Track } from '@nakamura/core'
import { api, type SessionUser } from '../api.ts'

const TRACK_LABEL: Record<Track, string> = { kana: '가나', kanji: '한자', toeic: '토익' }

export function Home({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [health, setHealth] = useState<string>('확인 중…')

  useEffect(() => {
    api<{ schema: number }>('health')
      .then(h => setHealth(`서버 연결됨 · DB 스키마 ${h.schema}`))
      .catch(() => setHealth('서버에 연결할 수 없음'))
  }, [])

  const logout = async () => {
    await api('auth/logout', { method: 'POST' }).catch(() => undefined)
    onLogout()
  }

  return (
    <main>
      <header className="topbar">
        <h1>NakamuraProject</h1>
        <button type="button" className="link" onClick={logout}>
          로그아웃
        </button>
      </header>
      <p>{user.name}님, 안녕하세요.</p>
      <p className="muted small">{health}</p>
      <ul className="tracks">
        {TRACKS.map(t => (
          <li key={t}>
            <strong>{TRACK_LABEL[t]}</strong>
            <span className="muted">하루 새 카드 {DEFAULT_NEW_PER_DAY}장</span>
          </li>
        ))}
      </ul>
      {user.isAdmin && (
        <p>
          <a href="#/admin/invites">초대 링크 관리</a>
        </p>
      )}
    </main>
  )
}
