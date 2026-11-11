// 관리 · 신고 (#/admin/reports): 상태별 목록, 해결 / 반려 / 다시 열기.
// 친구가 만든 노트(note.editable)는 "문제 수정"으로 칸을 바로 고칠 수 있다 (NoteEditForm, 같은 id 라 학습 기록은 그대로).
import { useState } from 'react'
import { api } from '../api.ts'
import { EmptyState, LoadError } from '../components/EmptyState.tsx'
import { NoteEditForm } from '../components/NoteEditForm.tsx'
import { noteLang } from '../components/NotePreview.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { fmtDateTime } from '../format.ts'
import { useApi } from '../hooks.ts'
import { TRACK_LABEL } from '../study.ts'
import {
  type Report,
  REPORT_REASON_LABEL,
  REPORT_STATUS_LABEL,
  type ReportFilter,
  type ReportsResponse,
  type ReportStatus,
} from '../types.ts'

const FILTERS: { value: ReportFilter; label: string }[] = [
  { value: 'open', label: '열림' },
  { value: 'resolved', label: '해결' },
  { value: 'rejected', label: '반려' },
  { value: 'all', label: '전체' },
]

/** 노트의 대표 글자: 가나 char · 한자 kanji · 토익 word */
const mainField = (note: Report['note']): string => {
  if (!note) return ''
  const f = note.fields
  const v = f.char ?? f.kanji ?? f.word ?? f.front
  return typeof v === 'string' ? v : ''
}

export function AdminReports() {
  const [filter, setFilter] = useState<ReportFilter>('open')
  const reports = useApi<ReportsResponse>(`admin/reports?status=${filter}`)
  const [busy, setBusy] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [error, setError] = useState('')

  const update = async (r: Report, status: ReportStatus) => {
    setBusy(r.id)
    setError('')
    try {
      const updated = await api<Report>(`admin/reports/${r.id}`, { method: 'PATCH', body: { status } })
      const list = reports.data?.reports ?? []
      reports.setData({
        reports:
          filter === 'all' || filter === updated.status
            ? list.map(x => (x.id === updated.id ? updated : x))
            : list.filter(x => x.id !== updated.id),
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** 같은 노트의 신고 모두에 고친 칸을 반영한다 */
  const edited = (noteId: string, fields: Record<string, unknown>) => {
    const list = reports.data?.reports ?? []
    reports.setData({ reports: list.map(x => (x.noteId === noteId && x.note ? { ...x, note: { ...x.note, fields } } : x)) })
    setEditing(null)
  }

  return (
    <section className="admin-section">
      <Segmented label="신고 상태" value={filter} onChange={setFilter} items={FILTERS} />
      {error && <p className="error">{error}</p>}
      {reports.data ? (
        reports.data.reports.length === 0 ? (
          <EmptyState icon="flag" title="신고가 없습니다">
            {filter === 'open' ? '처리할 신고가 없어요.' : '이 상태의 신고가 없습니다.'}
          </EmptyState>
        ) : (
          <ul className="report-list">
            {reports.data.reports.map(r => {
              const main = mainField(r.note)
              return (
                <li key={r.id} className="card report">
                  <div className="report-head">
                    {r.note ? (
                      <>
                        <span className="badge">{TRACK_LABEL[r.note.track] ?? r.note.track}</span>
                        <strong className="report-main" lang={noteLang(r.note.track, r.note.fields)}>
                          {main || r.noteId}
                        </strong>
                      </>
                    ) : (
                      <span className="muted">삭제된 노트 ({r.noteId})</span>
                    )}
                    <span className={`status status-${r.status}`}>{REPORT_STATUS_LABEL[r.status] ?? r.status}</span>
                  </div>
                  <p className="report-reason">
                    <strong>{REPORT_REASON_LABEL[r.reason] ?? r.reason}</strong>
                    {r.cardId && <span className="muted small"> · {r.cardId}</span>}
                  </p>
                  {r.body && <p className="report-body">{r.body}</p>}
                  {editing === r.id && r.note && (
                    <NoteEditForm
                      id={r.noteId}
                      track={r.note.track}
                      fields={r.note.fields}
                      onSaved={note => edited(r.noteId, note.fields)}
                      onCancel={() => setEditing(null)}
                    />
                  )}
                  <p className="muted small">
                    {r.userName} · {fmtDateTime(r.createdAt)}
                    {r.resolvedAt !== null &&
                      ` · ${fmtDateTime(r.resolvedAt)} ${REPORT_STATUS_LABEL[r.status] ?? ''}${r.resolvedBy !== null ? ` (${r.resolvedBy})` : ''}`}
                  </p>
                  <div className="actions">
                    {r.status === 'open' ? (
                      <>
                        <button type="button" disabled={busy === r.id} onClick={() => void update(r, 'resolved')}>
                          해결
                        </button>
                        <button type="button" className="secondary" disabled={busy === r.id} onClick={() => void update(r, 'rejected')}>
                          반려
                        </button>
                      </>
                    ) : (
                      <button type="button" className="secondary" disabled={busy === r.id} onClick={() => void update(r, 'open')}>
                        다시 열기
                      </button>
                    )}
                    {r.note?.editable && editing !== r.id && (
                      <button type="button" className="secondary" onClick={() => setEditing(r.id)}>
                        문제 수정
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )
      ) : reports.error ? (
        <LoadError error={reports.error} notReady={reports.notReady} onRetry={reports.reload} />
      ) : (
        <Skeleton lines={4} />
      )}
    </section>
  )
}
