// 문항 신고 대화상자. 관리자 검토 화면은 나중에 만든다 (서버 reports 테이블에 쌓인다).
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { REPORT_REASONS } from '../study.ts'

const BODY_MAX = 1000

export function ReportDialog({ noteId, cardId, onClose }: { noteId: string; cardId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState<string>(REPORT_REASONS[0][0])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('reports', { method: 'POST', body: { noteId, cardId, reason, body: body.trim() || undefined } })
      setSent(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose}>
      {sent ? (
        <div className="form">
          <p>신고했습니다. 고마워요!</p>
          <button type="button" onClick={onClose} autoFocus>
            닫기
          </button>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <h2>🚩 문항 신고</h2>
          <fieldset className="reasons">
            {REPORT_REASONS.map(([value, label]) => (
              <label key={value} className="radio">
                <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
                {label}
              </label>
            ))}
          </fieldset>
          <label>
            내용 (선택)
            <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={BODY_MAX} rows={3} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="button" className="secondary" onClick={onClose}>
              취소
            </button>
            <button type="submit" disabled={busy}>
              {busy ? '보내는 중…' : '신고하기'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
