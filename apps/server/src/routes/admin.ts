// 관리자 API: 문항 신고 처리 · 사용자 목록. app.ts 에서 /api 아래에 붙인다. 모두 관리자 필요.
// (초대 발급은 routes/auth.ts)
//   GET   /admin/reports?status=open|resolved|rejected|all   { reports: Report[] } 최근 것부터 최대 200개 (기본 open)
//   PATCH /admin/reports/:id   { status: 'resolved' | 'rejected' | 'open' } → Report
//   GET   /admin/users         { users: { id, name, isAdmin, createdAt, lastStudiedDay, reviewsWeek, showProgress }[] }
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import type { Note } from '@nakamura/core'
import { type AppEnv, requireAdmin } from '../auth/middleware.ts'
import { userOverview } from '../social.ts'
import { readBody } from './auth.ts'

export const REPORT_STATUSES = ['open', 'resolved', 'rejected'] as const
type ReportStatus = (typeof REPORT_STATUSES)[number]
const REPORT_LIST_MAX = 200

export interface Report {
  id: number
  noteId: string
  cardId: string | null
  userName: string
  reason: string
  body: string | null
  status: ReportStatus
  createdAt: number
  resolvedAt: number | null
  /** 처리한 관리자 이름 */
  resolvedBy: string | null
  note: { track: Note['track']; fields: Note['fields']; status: string } | null
}

interface ReportRow extends Omit<Report, 'note'> {
  track: Note['track'] | null
  fields: string | null
  noteStatus: string | null
}

const REPORT_SELECT = `SELECT r.id, r.note_id AS noteId, r.card_id AS cardId, u.name AS userName, r.reason, r.body, r.status,
       r.created_at AS createdAt, r.resolved_at AS resolvedAt, a.name AS resolvedBy,
       n.track AS track, n.fields AS fields, n.status AS noteStatus
  FROM reports r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN users a ON a.id = r.resolved_by
  LEFT JOIN notes n ON n.id = r.note_id`

const toReport = ({ track, fields, noteStatus, ...r }: ReportRow): Report => ({
  ...r,
  note: track !== null && fields !== null ? { track, fields: JSON.parse(fields), status: noteStatus! } : null,
})

const findReport = (db: DatabaseSync, id: number): Report | null => {
  const row = db.prepare(`${REPORT_SELECT} WHERE r.id = ?`).get(id) as ReportRow | undefined
  return row ? toReport(row) : null
}

export const adminRoutes = (db: DatabaseSync, opts: { now?: () => number } = {}) => {
  const now = opts.now ?? Date.now
  const r = new Hono<AppEnv>()
  r.use('/admin/*', requireAdmin)

  r.get('/admin/reports', c => {
    const status = c.req.query('status') ?? 'open'
    if (status !== 'all' && !(REPORT_STATUSES as readonly string[]).includes(status)) {
      return c.json({ error: `status 는 ${[...REPORT_STATUSES, 'all'].join(' | ')} 중 하나여야 합니다` }, 400)
    }
    const rows = (
      status === 'all'
        ? db.prepare(`${REPORT_SELECT} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`).all(REPORT_LIST_MAX)
        : db.prepare(`${REPORT_SELECT} WHERE r.status = ? ORDER BY r.created_at DESC, r.id DESC LIMIT ?`).all(status, REPORT_LIST_MAX)
    ) as unknown as ReportRow[]
    return c.json({ reports: rows.map(toReport) })
  })

  r.patch('/admin/reports/:id', async c => {
    const id = Number(c.req.param('id'))
    if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: '없는 신고입니다' }, 404)
    const body = await readBody(c)
    const status = body?.status
    if (!(REPORT_STATUSES as readonly unknown[]).includes(status)) {
      return c.json({ error: `status 는 ${REPORT_STATUSES.join(' | ')} 중 하나여야 합니다` }, 400)
    }
    // 다시 열면 처리 기록을 지운다. 처리(resolved · rejected)하면 처리한 관리자와 시각을 남긴다.
    const done = status !== 'open'
    const changed = db
      .prepare('UPDATE reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
      .run(status as string, done ? now() : null, done ? c.get('user')!.id : null, id).changes
    if (Number(changed) !== 1) return c.json({ error: '없는 신고입니다' }, 404)
    return c.json(findReport(db, id))
  })

  r.get('/admin/users', c => c.json({ users: userOverview(db, c.get('user')!.id, now()) }))

  return r
}
