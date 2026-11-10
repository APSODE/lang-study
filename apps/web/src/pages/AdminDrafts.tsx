// 관리 · 검토 대기 (#/admin/drafts): 친구가 만든 문제(초안) 목록, 공개 / 반려.
// 공개하면 바로 모두의 학습에 들어가고, 반려하면 퇴출(retired) 상태가 된다. 처리한 항목은 목록에서 뺀다.
import { useState } from 'react'
import { api } from '../api.ts'
import { EmptyState, LoadError } from '../components/EmptyState.tsx'
import { NotePreview, noteMain } from '../components/NotePreview.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { fmtDateTime } from '../format.ts'
import { useApi } from '../hooks.ts'
import { TRACK_LABEL } from '../study.ts'
import type { Draft, DraftsResponse } from '../types.ts'

export function AdminDrafts() {
  const drafts = useApi<DraftsResponse>('admin/drafts')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const review = async (d: Draft, action: 'publish' | 'reject') => {
    setBusy(d.id)
    setError('')
    try {
      await api(`admin/drafts/${encodeURIComponent(d.id)}/${action}`, { method: 'POST' })
      drafts.setData({ drafts: (drafts.data?.drafts ?? []).filter(x => x.id !== d.id) })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="admin-section">
      {error && <p className="error">{error}</p>}
      {drafts.data ? (
        drafts.data.drafts.length === 0 ? (
          <EmptyState title="검토할 문제가 없습니다">친구가 문제를 만들면 여기에 나와요.</EmptyState>
        ) : (
          <ul className="report-list">
            {drafts.data.drafts.map(d => (
              <li key={d.id} className="card report">
                <div className="report-head">
                  <span className="badge">{TRACK_LABEL[d.track] ?? d.track}</span>
                  <strong className="report-main" lang={d.track === 'toeic' ? 'en' : 'ja'}>
                    {noteMain(d.fields) || d.id}
                  </strong>
                </div>
                <NotePreview track={d.track} fields={d.fields} />
                <p className="muted small">
                  {d.uploader ?? '삭제된 사용자'} · {fmtDateTime(d.createdAt)}
                </p>
                <div className="actions">
                  <button type="button" disabled={busy === d.id} onClick={() => void review(d, 'publish')}>
                    공개
                  </button>
                  <button type="button" className="secondary" disabled={busy === d.id} onClick={() => void review(d, 'reject')}>
                    반려
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : drafts.error ? (
        <LoadError error={drafts.error} notReady={drafts.notReady} onRetry={drafts.reload} />
      ) : (
        <Skeleton lines={4} />
      )}
    </section>
  )
}
