import { type FormEvent, useState } from 'react'
import { api, type SessionUser } from '../api.ts'

export function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { user } = await api<{ user: SessionUser }>('auth/login', { method: 'POST', body: { name, password } })
      onLogin(user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main>
      <h1>NakamuraProject</h1>
      <p className="muted">로그인</p>
      <form className="form" onSubmit={submit}>
        <label>
          이름
          <input value={name} onChange={e => setName(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        </label>
        <label>
          비밀번호
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
      </form>
      <p className="muted small">계정은 초대 링크로만 만들 수 있습니다.</p>
    </main>
  )
}
