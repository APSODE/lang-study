// 설정 (#/settings): 프로필(닉네임 · 진도 공개 · 칭호 언어 · 시간대) · 학습(트랙별 하루 새 카드 · 트랙별 작문 하루 새 문제 · 항목별 하루 새 카드) · 비밀번호 변경 · 정보.
// me/profile · auth/password 가 아직 없으면(404) 그 부분만 "준비 중"으로 보여 준다.
import { type FormEvent, useEffect, useState } from 'react'
import { TRACKS, type TitlePref, type Track } from '@nakamura/core'
import { version } from '../../package.json'
import { api, ApiError, type SessionUser } from '../api.ts'
import { Card } from '../components/Card.tsx'
import { LoadError } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { useSummary } from '../components/Shell.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { fmtDate } from '../format.ts'
import { useApi } from '../hooks.ts'
import { TRACK_LABEL } from '../study.ts'
import type { Profile } from '../types.ts'

type NewPerDay = Record<Track, number>
interface StudySettings {
  newPerDay: NewPerDay
  /** 예전 서버 값 (한자 일작) */
  writeNewPerDay: number
  /** 작문 모드가 있는 트랙마다 (kanji · toeic · toefl). 예전 서버는 없을 수 있다 */
  writeNewPerDays?: Partial<Record<Track, number>>
  /** 친구가 만든 항목(공개된 카드가 있는 것, 만든 순서)마다 하루 새 카드 수. 예전 서버는 없을 수 있다 */
  decks?: { key: string; name: string; newPerDay: number }[]
}
const MAX = 100

const TITLE_PREFS: { value: TitlePref; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: 'ja', label: '일본어' },
  { value: 'en', label: '영어' },
]

const COMMON_ZONES: [string, string][] = [
  ['Asia/Seoul', '서울'],
  ['Asia/Tokyo', '도쿄'],
  ['Asia/Shanghai', '베이징 · 상하이'],
  ['Asia/Taipei', '타이베이'],
  ['Asia/Singapore', '싱가포르'],
  ['Asia/Bangkok', '방콕'],
  ['Asia/Kolkata', '인도'],
  ['Europe/London', '런던'],
  ['Europe/Paris', '파리'],
  ['Europe/Berlin', '베를린'],
  ['America/New_York', '뉴욕'],
  ['America/Chicago', '시카고'],
  ['America/Denver', '덴버'],
  ['America/Los_Angeles', '로스앤젤레스'],
  ['America/Vancouver', '밴쿠버'],
  ['Australia/Sydney', '시드니'],
  ['Pacific/Auckland', '오클랜드'],
  ['UTC', '협정 세계시'],
]

const browserZone = (): string | null => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/** 닉네임: 비우고 저장하면 지운다 (로그인 이름이 보인다). 로그인 이름은 바뀌지 않는다. */
function NicknameForm({
  profile,
  onSaved,
}: {
  profile: Profile
  onSaved: (p: Profile) => void
}) {
  const [draft, setDraft] = useState(profile.displayName ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => setDraft(profile.displayName ?? ''), [profile.displayName])

  const next = draft.trim()
  const unchanged = next === (profile.displayName ?? '')

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (unchanged) return
    setBusy(true)
    setMsg(null)
    try {
      const p = await api<Profile>('me/profile', { method: 'PUT', body: { displayName: next === '' ? null : next } })
      onSaved(p)
      setMsg({ ok: true, text: p.displayName ? '닉네임을 바꿨습니다.' : '닉네임을 지웠습니다. 로그인 이름이 보입니다.' })
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label>
        닉네임
        <input
          value={draft}
          onChange={e => {
            setMsg(null)
            setDraft(e.target.value)
          }}
          placeholder={profile.name}
          maxLength={20}
          autoComplete="nickname"
          autoCapitalize="none"
          spellCheck={false}
        />
        <span className="muted small">친구 · 순위 화면에 보이는 이름 (2~20자 한글 · 영문 · 숫자 · _ · -). 비우면 로그인 이름이 보입니다.</span>
      </label>
      {msg && (
        <p className={msg.ok ? 'muted small' : 'error'} role="status">
          {msg.text}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={busy || unchanged}>
          {busy ? '저장 중…' : '닉네임 저장'}
        </button>
      </div>
    </form>
  )
}

function ProfileSection({ user, onUserChange }: { user: SessionUser; onUserChange?: (u: SessionUser) => void }) {
  const profile = useApi<Profile>('me/profile')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const summary = useSummary()

  const save = async (patch: Partial<Pick<Profile, 'showProgress' | 'tz' | 'titleLang'>>) => {
    setBusy(true)
    setMsg(null)
    try {
      const p = await api<Profile>('me/profile', { method: 'PUT', body: patch })
      profile.setData(p)
      setMsg({ ok: true, text: '저장했습니다.' })
      // 시간대가 바뀌면 하루 경계 · 연속 학습일이, 칭호 언어가 바뀌면 홈 레벨 카드의 칭호가 바뀐다
      if (patch.tz !== undefined || patch.titleLang !== undefined) summary.reload()
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const p = profile.data
  const zones = [...COMMON_ZONES]
  for (const z of [p?.tz, browserZone()]) if (z && !zones.some(([id]) => id === z)) zones.unshift([z, z === p?.tz ? '현재' : '이 기기'])

  return (
    <Card title="프로필">
      <dl className="kv">
        <div>
          <dt>로그인 이름</dt>
          <dd>
            {user.name}
            {user.isAdmin && <span className="badge">관리자</span>}
          </dd>
        </div>
        {p && (
          <div>
            <dt>가입일</dt>
            <dd>{fmtDate(p.createdAt)}</dd>
          </div>
        )}
      </dl>
      {p && (
        <NicknameForm
          profile={p}
          onSaved={next => {
            profile.setData(next)
            onUserChange?.({ ...user, display: next.display })
          }}
        />
      )}
      {p ? (
        <div className="form">
          <label className="switch-row">
            <span>
              내 진도 · 순위를 친구에게 보이기
              <span className="muted small block">끄면 친구 화면과 순위에 내 기록이 나오지 않습니다.</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              checked={p.showProgress}
              disabled={busy}
              onChange={e => void save({ showProgress: e.target.checked })}
            />
          </label>
          {p.titleLang !== undefined && (
            <div className="field">
              <span>칭호</span>
              <Segmented
                label="칭호 언어"
                value={p.titleLang}
                onChange={v => {
                  if (!busy && v !== p.titleLang) void save({ titleLang: v })
                }}
                items={TITLE_PREFS}
              />
              <span className="muted small">자동은 복습을 더 많이 한 언어(일본어 · 영어)의 칭호를 씁니다. 친구에게도 이 칭호가 보입니다.</span>
            </div>
          )}
          <label>
            시간대
            <select value={p.tz} disabled={busy} onChange={e => void save({ tz: e.target.value })}>
              {zones.map(([id, label]) => (
                <option key={id} value={id}>
                  {label} ({id})
                </option>
              ))}
            </select>
            <span className="muted small">하루는 이 시간대의 새벽 4시에 바뀝니다.</span>
          </label>
          {msg && <p className={msg.ok ? 'muted small' : 'error'} role="status">{msg.text}</p>}
        </div>
      ) : profile.error ? (
        <LoadError error={profile.error} notReady={profile.notReady} onRetry={profile.reload} />
      ) : (
        <Skeleton lines={2} />
      )}
    </Card>
  )
}

function StudySection() {
  const [values, setValues] = useState<StudySettings | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const summary = useSummary()

  useEffect(() => {
    api<StudySettings>('study/settings')
      .then(setValues)
      .catch(err => setError((err as Error).message))
  }, [])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!values) return
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const body = {
        newPerDay: values.newPerDay,
        ...(values.writeNewPerDays ? { writeNewPerDays: values.writeNewPerDays } : { writeNewPerDay: values.writeNewPerDay }),
        ...(values.decks?.length ? { deckNewPerDay: Object.fromEntries(values.decks.map(d => [d.key, d.newPerDay])) } : {}),
      }
      const r = await api<StudySettings>('study/settings', { method: 'PUT', body })
      setValues(r)
      setSaved(true)
      summary.reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="학습">
      <p className="muted small">트랙마다 하루에 새로 볼 카드 수 (0–{MAX}). 복습할 카드는 제한 없이 나옵니다.</p>
      {values === null ? (
        error ? <p className="error">{error}</p> : <Skeleton lines={3} />
      ) : (
        <form className="form" onSubmit={save}>
          <div className="row-3">
            {TRACKS.map(t => (
              <label key={t}>
                {TRACK_LABEL[t]}
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX}
                  step={1}
                  value={values.newPerDay[t]}
                  onChange={e => {
                    setSaved(false)
                    setValues({ ...values, newPerDay: { ...values.newPerDay, [t]: Math.trunc(Number(e.target.value)) } })
                  }}
                  required
                />
              </label>
            ))}
          </div>
          {values.writeNewPerDays ? (
            <div className="field">
              <span>작문 하루 새 문제</span>
              <div className="row-3">
                {(Object.keys(values.writeNewPerDays) as Track[]).map(t => (
                  <label key={t}>
                    {TRACK_LABEL[t]}
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX}
                      step={1}
                      value={values.writeNewPerDays![t]}
                      onChange={e => {
                        setSaved(false)
                        setValues({
                          ...values,
                          writeNewPerDays: { ...values.writeNewPerDays, [t]: Math.trunc(Number(e.target.value)) },
                        })
                      }}
                      required
                    />
                  </label>
                ))}
              </div>
              <span className="muted small">한자 일작 · 토익 · 토플 영작에서 하루에 새로 볼 문제 수. 트랙의 새 카드 수와 따로 셉니다.</span>
            </div>
          ) : (
            <label>
              작문 하루 새 문제
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX}
                step={1}
                value={values.writeNewPerDay}
                onChange={e => {
                  setSaved(false)
                  setValues({ ...values, writeNewPerDay: Math.trunc(Number(e.target.value)) })
                }}
                required
              />
              <span className="muted small">일본어 일작에서 하루에 새로 볼 문제 수. 한자 트랙의 새 카드 수와 따로 셉니다.</span>
            </label>
          )}
          {values.decks && values.decks.length > 0 && (
            <div className="field">
              <span>만든 항목 하루 새 카드</span>
              <div className="row-3">
                {values.decks.map(d => (
                  <label key={d.key}>
                    {d.name}
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX}
                      step={1}
                      value={d.newPerDay}
                      onChange={e => {
                        setSaved(false)
                        const n = Math.trunc(Number(e.target.value))
                        setValues({ ...values, decks: values.decks!.map(x => (x.key === d.key ? { ...x, newPerDay: n } : x)) })
                      }}
                      required
                    />
                  </label>
                ))}
              </div>
              <span className="muted small">친구가 만든 항목마다 하루에 새로 볼 카드 수.</span>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="submit" disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
            {saved && (
              <span className="muted small" role="status">
                저장했습니다.
              </span>
            )}
          </div>
        </form>
      )}
    </Card>
  )
}

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) {
      setMsg({ ok: false, text: '새 비밀번호 확인이 일치하지 않습니다' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await api<{ ok: true }>('auth/password', { method: 'POST', body: { current, next } })
      setCurrent('')
      setNext('')
      setConfirm('')
      setMsg({ ok: true, text: '비밀번호를 바꿨습니다.' })
    } catch (err) {
      const notReady = err instanceof ApiError && err.status === 404
      setMsg({ ok: false, text: notReady ? '비밀번호 변경은 준비 중입니다.' : (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="비밀번호 변경">
      <form className="form" onSubmit={submit}>
        <label>
          현재 비밀번호
          <input
            type="password"
            value={current}
            onChange={e => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          새 비밀번호
          <input
            type="password"
            value={next}
            onChange={e => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
          <span className="muted small">8자 이상</span>
        </label>
        <label>
          새 비밀번호 확인
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
        </label>
        {msg && (
          <p className={msg.ok ? 'muted small' : 'error'} role="status">
            {msg.text}
          </p>
        )}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? '바꾸는 중…' : '비밀번호 바꾸기'}
          </button>
        </div>
      </form>
    </Card>
  )
}

function AboutSection({ onLogout }: { onLogout: () => void }) {
  const [health, setHealth] = useState('확인 중…')
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
    <Card title="정보">
      <dl className="kv">
        <div>
          <dt>버전</dt>
          <dd>NakamuraProject {version}</dd>
        </div>
        <div>
          <dt>서버</dt>
          <dd>{health}</dd>
        </div>
      </dl>
      <div className="actions">
        <button type="button" className="secondary" onClick={() => void logout()}>
          <Icon name="logout" size={20} />
          로그아웃
        </button>
      </div>
    </Card>
  )
}

export function Settings({
  user,
  onLogout,
  onUserChange,
}: {
  user: SessionUser
  onLogout: () => void
  /** 닉네임을 바꾸면 위 막대 · 인사말도 바로 바뀌게 */
  onUserChange?: (u: SessionUser) => void
}) {
  return (
    <div className="page settings-page">
      <ProfileSection user={user} onUserChange={onUserChange} />
      <StudySection />
      <PasswordSection />
      <AboutSection onLogout={onLogout} />
    </div>
  )
}
