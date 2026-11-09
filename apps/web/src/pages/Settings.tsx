// 설정 (#/settings): 트랙별 하루 새 카드 수. 복습 카드는 제한하지 않는다.
import { type FormEvent, useEffect, useState } from 'react'
import { TRACKS, type Track } from '@nakamura/core'
import { api } from '../api.ts'
import { TRACK_LABEL } from '../study.ts'

type NewPerDay = Record<Track, number>
const MAX = 100

export function Settings() {
  const [values, setValues] = useState<NewPerDay | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ newPerDay: NewPerDay }>('study/settings')
      .then(r => setValues(r.newPerDay))
      .catch(err => setError((err as Error).message))
  }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!values) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const r = await api<{ newPerDay: NewPerDay }>('study/settings', { method: 'PUT', body: { newPerDay: values } })
      setValues(r.newPerDay)
      setSaved(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <header className="topbar">
        <h1>설정</h1>
        <a href="#/">홈</a>
      </header>
      <h2>하루 새 카드</h2>
      <p className="muted small">트랙마다 하루에 새로 볼 카드 수 (0–{MAX}). 복습할 카드는 제한 없이 나옵니다.</p>
      {values === null ? (
        error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>
      ) : (
        <form className="form" onSubmit={save}>
          {TRACKS.map(t => (
            <label key={t}>
              {TRACK_LABEL[t]}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX}
                step={1}
                value={values[t]}
                onChange={e => {
                  setSaved(false)
                  setValues({ ...values, [t]: Math.trunc(Number(e.target.value)) })
                }}
                required
              />
            </label>
          ))}
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
          {saved && <p className="muted small">저장했습니다.</p>}
        </form>
      )}
    </main>
  )
}
