// 내 정보 API. app.ts 에서 /api 아래에 붙인다. 모두 로그인 필요.
//   GET /me/profile    { name, isAdmin, showProgress, tz, createdAt }
//   PUT /me/profile    { showProgress?: boolean, tz?: string } → 같은 모양
// tz 는 IANA 시간대 이름 (하루 경계 · 연속 학습일 계산, study/day.ts). 비밀번호 변경은 routes/auth.ts.
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { type AppEnv, requireUser } from '../auth/middleware.ts'
import { canonicalTz } from '../study/day.ts'
import { readBody } from './auth.ts'

export interface Profile {
  name: string
  isAdmin: boolean
  showProgress: boolean
  tz: string
  createdAt: number
}

const profileOf = (db: DatabaseSync, userId: number): Profile => {
  const row = db
    .prepare('SELECT name, is_admin AS isAdmin, show_progress AS showProgress, tz, created_at AS createdAt FROM users WHERE id = ?')
    .get(userId) as { name: string; isAdmin: number; showProgress: number; tz: string; createdAt: number }
  return { ...row, isAdmin: row.isAdmin === 1, showProgress: row.showProgress === 1 }
}

export const meRoutes = (db: DatabaseSync) => {
  const r = new Hono<AppEnv>()
  r.use('/me/*', requireUser)

  r.get('/me/profile', c => c.json(profileOf(db, c.get('user')!.id)))

  r.put('/me/profile', async c => {
    const body = await readBody(c)
    if (!body) return c.json({ error: '요청 형식이 올바르지 않습니다' }, 400)
    const { showProgress, tz } = body
    if (showProgress !== undefined && typeof showProgress !== 'boolean') {
      return c.json({ error: 'showProgress 는 true 또는 false 여야 합니다' }, 400)
    }
    const zone = tz === undefined ? undefined : canonicalTz(tz)
    if (zone === null) return c.json({ error: '알 수 없는 시간대입니다 (예: Asia/Seoul)' }, 400)
    const userId = c.get('user')!.id
    if (showProgress !== undefined) db.prepare('UPDATE users SET show_progress = ? WHERE id = ?').run(showProgress ? 1 : 0, userId)
    if (zone !== undefined) db.prepare('UPDATE users SET tz = ? WHERE id = ?').run(zone, userId)
    return c.json(profileOf(db, userId))
  })

  return r
}
