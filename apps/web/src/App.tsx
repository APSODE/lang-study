import { useEffect, useState } from 'react'
import { DEFAULT_NEW_PER_DAY, TRACKS, type Track } from '@nakamura/core'

const TRACK_LABEL: Record<Track, string> = { kana: '가나', kanji: '한자', toeic: '토익' }

export function App() {
  const [health, setHealth] = useState<string>('확인 중…')

  useEffect(() => {
    // 상대 경로: BASE_PATH 아래에 배포돼도 그대로 동작한다
    fetch('api/health')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((h: { schema: number }) => setHealth(`서버 연결됨 · DB 스키마 ${h.schema}`))
      .catch(() => setHealth('서버에 연결할 수 없음'))
  }, [])

  return (
    <main>
      <h1>NakamuraProject</h1>
      <p className="muted">{health}</p>
      <ul className="tracks">
        {TRACKS.map(t => (
          <li key={t}>
            <strong>{TRACK_LABEL[t]}</strong>
            <span className="muted">하루 새 카드 {DEFAULT_NEW_PER_DAY}장</span>
          </li>
        ))}
      </ul>
    </main>
  )
}
