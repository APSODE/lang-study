import { useCallback, useEffect, useState } from 'react'
import { api, type SessionUser } from '../api.ts'
import { type StudySummary, TRACK_LABEL } from '../study.ts'

export function Home({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [summary, setSummary] = useState<StudySummary | null>(null)
  const [error, setError] = useState('')
  const [health, setHealth] = useState<string>('확인 중…')

  useEffect(() => {
    api<{ schema: number }>('health')
      .then(h => setHealth(`서버 연결됨 · DB 스키마 ${h.schema}`))
      .catch(() => setHealth('서버에 연결할 수 없음'))
  }, [])

  const load = useCallback(() => {
    setError('')
    api<StudySummary>('study/summary')
      .then(setSummary)
      .catch(err => setError((err as Error).message))
  }, [])

  useEffect(load, [load])

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

      {error && (
        <p className="error">
          {error}{' '}
          <button type="button" className="link" onClick={load}>
            다시 시도
          </button>
        </p>
      )}
      {summary === null ? (
        !error && <p className="muted">불러오는 중…</p>
      ) : (
        <>
          <p className="streak">
            🔥 연속 <strong>{summary.streak}</strong>일 · 오늘 복습 <strong>{summary.reviewsToday}</strong>장
          </p>
          <ul className="tracks">
            {summary.tracks.map(t => (
              <li key={t.track}>
                <div className="track-head">
                  <strong>{TRACK_LABEL[t.track]}</strong>
                  {t.notes > 0 && <span className="muted small">배운 카드 {t.learned}장</span>}
                </div>
                {t.notes === 0 ? (
                  <span className="muted">준비 중</span>
                ) : (
                  <>
                    <div className="track-stats">
                      <span>
                        복습 <strong>{t.due}</strong>
                      </span>
                      <span>
                        새 카드 <strong>{t.newLeft}</strong>
                      </span>
                      <span className="muted small">오늘 {t.reviewsToday}장</span>
                    </div>
                    <a className="button" href={`#/study/${t.track}`}>
                      {t.due + t.newLeft > 0 ? '학습 시작' : '오늘 끝 · 더 보기'}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <nav className="links">
        <a href="#/kana">가나 50음도</a>
        <a href="#/settings">설정</a>
        {user.isAdmin && <a href="#/admin/invites">초대 링크 관리</a>}
      </nav>
      <p className="muted small">{health}</p>
    </main>
  )
}
