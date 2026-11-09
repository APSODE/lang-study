import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { api } from '../api.ts'

type Invite = { code: string; url: string; expiresAt: number; maxUses: number; uses: number; createdAt: number }

const fmt = (ms: number) =>
  new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** 클립보드는 https(또는 localhost)에서만 된다. 안 되면 직접 복사하도록 띄운다. */
const copy = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    window.prompt('아래 링크를 복사하세요', text)
    return false
  }
}

export function AdminInvites() {
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [days, setDays] = useState(7)
  const [maxUses, setMaxUses] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')

  const load = useCallback(() => {
    api<{ invites: Invite[] }>('admin/invites')
      .then(r => setInvites(r.invites))
      .catch(err => setError((err as Error).message))
  }, [])

  useEffect(load, [load])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api<Invite>('admin/invites', { method: 'POST', body: { days, maxUses } })
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (code: string) => {
    if (!window.confirm('이 초대 링크를 삭제할까요? 더 이상 가입에 쓸 수 없습니다.')) return
    setError('')
    try {
      await api(`admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' })
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const copyLink = async (inv: Invite) => {
    if (await copy(inv.url)) setCopied(inv.code)
  }

  return (
    <section className="admin-section">
      <p className="muted small">초대 링크로만 가입할 수 있습니다. 링크를 만들어 친구에게 보내 주세요.</p>

      <form className="form card" onSubmit={create}>
        <div className="row">
          <label>
            유효 기간(일)
            <input type="number" min={1} max={30} value={days} onChange={e => setDays(Number(e.target.value))} required />
          </label>
          <label>
            사용 횟수
            <input
              type="number"
              min={1}
              max={20}
              value={maxUses}
              onChange={e => setMaxUses(Number(e.target.value))}
              required
            />
          </label>
        </div>
        <button type="submit" disabled={busy}>
          {busy ? '만드는 중…' : '새 초대 링크 만들기'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      <h2 className="section-title">사용 가능한 링크</h2>
      {invites === null ? (
        <p className="muted">불러오는 중…</p>
      ) : invites.length === 0 ? (
        <p className="muted">사용 가능한 초대 링크가 없습니다.</p>
      ) : (
        <ul className="invites">
          {invites.map(inv => (
            <li key={inv.code}>
              <code className="url">{inv.url}</code>
              <span className="muted small">
                {fmt(inv.expiresAt)}까지 · {inv.uses}/{inv.maxUses}회 사용
              </span>
              <div className="actions">
                <button type="button" onClick={() => copyLink(inv)}>
                  {copied === inv.code ? '복사됨' : '링크 복사'}
                </button>
                <button type="button" className="danger" onClick={() => remove(inv.code)}>
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
