// 관리 · 검토 대기 (#/admin/drafts): 친구가 만든 문제(초안) 목록, 공개 / 반려.
// 공개하면 바로 모두의 학습에 들어가고, 반려하면 퇴출(retired) 상태가 된다. 처리한 항목은 목록에서 뺀다.
// 파일로 올린 문제는 파일(묶음)마다 카드 하나: 모두 공개 / 모두 반려, 펼치면 하나씩 공개 / 반려.
// 직접 만든 문제는 그 아래에 하나씩.
import { useState } from 'react'
import { api } from '../api.ts'
import { EmptyState, LoadError } from '../components/EmptyState.tsx'
import { NotePreview, noteLang, noteMain } from '../components/NotePreview.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { fmtDateTime, fmtNum } from '../format.ts'
import { useApi } from '../hooks.ts'
import { TRACK_LABEL } from '../study.ts'
import type { Draft, DraftBatch, DraftsResponse } from '../types.ts'

type Action = 'publish' | 'reject'

function DraftItem({ d, busy, onReview }: { d: Draft; busy: boolean; onReview: (d: Draft, a: Action) => void }) {
  return (
    <li className="card report">
      <div className="report-head">
        <span className="badge">{TRACK_LABEL[d.track] ?? d.track}</span>
        <strong className="report-main" lang={noteLang(d.track, d.fields)}>
          {noteMain(d.fields) || d.id}
        </strong>
      </div>
      <NotePreview track={d.track} fields={d.fields} />
      <p className="muted small">
        {d.uploader ?? '삭제된 사용자'} · {fmtDateTime(d.createdAt)}
      </p>
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => onReview(d, 'publish')}>
          공개
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => onReview(d, 'reject')}>
          반려
        </button>
      </div>
    </li>
  )
}

export function AdminDrafts() {
  const drafts = useApi<DraftsResponse>('admin/drafts')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const review = async (d: Draft, action: Action) => {
    setBusy(d.id)
    setError('')
    try {
      await api(`admin/drafts/${encodeURIComponent(d.id)}/${action}`, { method: 'POST' })
      const data = drafts.data ?? { drafts: [], batches: [] }
      drafts.setData({
        drafts: data.drafts.filter(x => x.id !== d.id),
        batches: (data.batches ?? [])
          .map(b => (b.id === d.batch ? { ...b, count: b.count - 1 } : b))
          .filter(b => b.count > 0),
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const reviewBatch = async (b: DraftBatch, action: Action) => {
    setBusy(`batch:${b.id}`)
    setError('')
    try {
      await api(`admin/batches/${encodeURIComponent(b.id)}/${action}`, { method: 'POST' })
      const data = drafts.data ?? { drafts: [], batches: [] }
      drafts.setData({
        drafts: data.drafts.filter(x => x.batch !== b.id),
        batches: (data.batches ?? []).filter(x => x.id !== b.id),
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const data = drafts.data
  const batches = data?.batches ?? []
  const singles = data?.drafts.filter(d => !d.batch) ?? []

  return (
    <section className="admin-section">
      {error && <p className="error">{error}</p>}
      {data ? (
        batches.length === 0 && singles.length === 0 ? (
          <EmptyState title="검토할 문제가 없습니다">친구가 문제를 만들면 여기에 나와요.</EmptyState>
        ) : (
          <ul className="report-list">
            {batches.map(b => {
              const items = data.drafts.filter(d => d.batch === b.id)
              const batchBusy = busy === `batch:${b.id}`
              return (
                <li key={b.id} className="card report">
                  <div className="report-head">
                    <span className="badge">{TRACK_LABEL[b.track] ?? b.track}</span>
                    <strong className="report-main">{b.deck ?? `${TRACK_LABEL[b.track] ?? b.track} 파일`}</strong>
                  </div>
                  <p className="muted small">
                    파일 · {b.uploader ?? '삭제된 사용자'} · {fmtDateTime(b.createdAt)} · 검토 대기 {fmtNum(b.count)}개
                  </p>
                  <div className="actions">
                    <button type="button" disabled={busy !== null} onClick={() => void reviewBatch(b, 'publish')}>
                      {batchBusy ? '처리 중…' : `모두 공개 (${fmtNum(b.count)})`}
                    </button>
                    <button type="button" className="secondary" disabled={busy !== null} onClick={() => void reviewBatch(b, 'reject')}>
                      모두 반려
                    </button>
                  </div>
                  <details className="aid">
                    <summary className="small muted">
                      하나씩 보기{items.length < b.count ? ` (목록에 ${fmtNum(items.length)}개만 보임)` : ''}
                    </summary>
                    <ul className="report-list">
                      {items.map(d => (
                        <DraftItem key={d.id} d={d} busy={busy !== null} onReview={(x, a) => void review(x, a)} />
                      ))}
                    </ul>
                  </details>
                </li>
              )
            })}
            {singles.map(d => (
              <DraftItem key={d.id} d={d} busy={busy === d.id} onReview={(x, a) => void review(x, a)} />
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
