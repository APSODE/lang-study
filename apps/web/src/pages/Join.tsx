import { type FormEvent, useEffect, useState } from 'react'
import { api, type SessionUser } from '../api.ts'

type InviteCheck = { valid: boolean; expiresAt: number | null }

export function Join({ code, onLogin }: { code: string; onLogin: (user: SessionUser) => void }) {
  const [check, setCheck] = useState<InviteCheck | 'error' | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api<InviteCheck>(`invites/${encodeURIComponent(code)}`)
      .then(r => alive && setCheck(r))
      .catch(() => alive && setCheck('error'))
    return () => {
      alive = false
    }
  }, [code])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password !== password2) {
      setError('비밀번호 확인이 일치하지 않습니다')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { user } = await api<{ user: SessionUser }>('auth/signup', {
        method: 'POST',
        body: { invite: code, name, password },
      })
      onLogin(user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (check === null) {
    return (
      <main>
        <h1>NakamuraProject</h1>
        <p className="muted">초대 링크 확인 중…</p>
      </main>
    )
  }
  if (check === 'error' || !check.valid) {
    return (
      <main>
        <h1>NakamuraProject</h1>
        <div className="notice">
          {check === 'error' ? (
            <p>서버에 연결할 수 없습니다. 잠시 뒤에 다시 열어 주세요.</p>
          ) : (
            <p>이 초대 링크는 만료되었거나 이미 사용되었습니다. 초대한 사람에게 새 링크를 부탁해 주세요.</p>
          )}
        </div>
        <p>
          <a href="#/login">이미 계정이 있다면 로그인</a>
        </p>
      </main>
    )
  }

  return (
    <main>
      <h1>NakamuraProject</h1>
      <p className="muted">초대받으셨습니다. 사용할 이름과 비밀번호를 정해 주세요.</p>
      <form className="form" onSubmit={submit}>
        <label>
          이름
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            minLength={2}
            maxLength={20}
            pattern="[A-Za-z0-9가-힣_\-]{2,20}"
            title="2~20자의 한글 · 영문 · 숫자 · _ · -"
            required
          />
          <span className="muted small">2~20자, 한글 · 영문 · 숫자 · _ · -</span>
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
          <span className="muted small">8자 이상</span>
        </label>
        <label>
          비밀번호 확인
          <input
            type="password"
            value={password2}
            onChange={e => setPassword2(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? '가입 중…' : '가입하기'}
        </button>
      </form>
    </main>
  )
}
