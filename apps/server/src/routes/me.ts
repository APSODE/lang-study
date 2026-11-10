// 내 정보 API. app.ts 에서 /api 아래에 붙인다. 모두 로그인 필요.
//   GET /me/profile    { name, displayName, display, isAdmin, showProgress, tz, titleLang, createdAt }
//   PUT /me/profile    { showProgress?: boolean, tz?: string, displayName?: string | null, titleLang?: 'auto' | 'ja' | 'en' } → 같은 모양
// titleLang 은 칭호 언어 설정 (auto = 복습 XP 가 더 많은 언어, study/level.ts).
// name 은 로그인 이름(바뀌지 않는다), displayName 은 닉네임(없으면 null), display 는 보이는 이름(displayName ?? name).
// 닉네임은 가입 이름과 같은 규칙(auth/users.ts checkName)이고, 다른 사람의 닉네임 · 로그인 이름과 겹치면 409. null · "" 은 지운다.
// tz 는 IANA 시간대 이름 (하루 경계 · 연속 학습일 계산, study/day.ts). 비밀번호 변경은 routes/auth.ts.
import type { DatabaseSync } from 'node:sqlite'
import { isTitlePref, type TitlePref } from '@nakamura/core'
import { Hono } from 'hono'
import { type AppEnv, requireUser } from '../auth/middleware.ts'
import { checkName, nameTaken } from '../auth/users.ts'
import { canonicalTz } from '../study/day.ts'
import { readBody } from './auth.ts'

export interface Profile {
  /** 로그인 이름 */
  name: string
  /** 닉네임. 없으면 null */
  displayName: string | null
  /** 보이는 이름 (displayName ?? name) */
  display: string
  isAdmin: boolean
  showProgress: boolean
  tz: string
  /** 칭호 언어 설정 */
  titleLang: TitlePref
  createdAt: number
}

const profileOf = (db: DatabaseSync, userId: number): Profile => {
  const row = db
    .prepare(
      `SELECT name, display_name AS displayName, is_admin AS isAdmin, show_progress AS showProgress, tz, title_lang AS titleLang, created_at AS createdAt
         FROM users WHERE id = ?`,
    )
    .get(userId) as {
    name: string
    displayName: string | null
    isAdmin: number
    showProgress: number
    tz: string
    titleLang: string
    createdAt: number
  }
  return {
    name: row.name,
    displayName: row.displayName,
    display: row.displayName ?? row.name,
    isAdmin: row.isAdmin === 1,
    showProgress: row.showProgress === 1,
    tz: row.tz,
    titleLang: isTitlePref(row.titleLang) ? row.titleLang : 'auto',
    createdAt: row.createdAt,
  }
}

export const meRoutes = (db: DatabaseSync) => {
  const r = new Hono<AppEnv>()
  r.use('/me/*', requireUser)

  r.get('/me/profile', c => c.json(profileOf(db, c.get('user')!.id)))

  r.put('/me/profile', async c => {
    const body = await readBody(c)
    if (!body) return c.json({ error: '요청 형식이 올바르지 않습니다' }, 400)
    const { showProgress, tz, displayName, titleLang } = body
    if (showProgress !== undefined && typeof showProgress !== 'boolean') {
      return c.json({ error: 'showProgress 는 true 또는 false 여야 합니다' }, 400)
    }
    if (titleLang !== undefined && !isTitlePref(titleLang)) {
      return c.json({ error: "titleLang 은 'auto' · 'ja' · 'en' 중 하나여야 합니다" }, 400)
    }
    const zone = tz === undefined ? undefined : canonicalTz(tz)
    if (zone === null) return c.json({ error: '알 수 없는 시간대입니다 (예: Asia/Seoul)' }, 400)
    // 닉네임: undefined = 그대로, null · 빈 문자열 = 지우기
    const clear = displayName === null || (typeof displayName === 'string' && displayName.trim() === '')
    if (displayName !== undefined && !clear) {
      const problem = checkName(displayName)
      if (problem) return c.json({ error: problem }, 400)
    }
    const userId = c.get('user')!.id
    if (displayName !== undefined) {
      const next = clear ? null : (displayName as string)
      db.exec('BEGIN IMMEDIATE')
      try {
        if (next !== null && nameTaken(db, next, userId)) {
          db.exec('ROLLBACK')
          return c.json({ error: '이미 쓰고 있는 이름입니다' }, 409)
        }
        db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(next, userId)
        db.exec('COMMIT')
      } catch (err) {
        if (db.isTransaction) db.exec('ROLLBACK')
        throw err
      }
    }
    if (showProgress !== undefined) db.prepare('UPDATE users SET show_progress = ? WHERE id = ?').run(showProgress ? 1 : 0, userId)
    if (titleLang !== undefined) db.prepare('UPDATE users SET title_lang = ? WHERE id = ?').run(titleLang, userId)
    if (zone !== undefined) db.prepare('UPDATE users SET tz = ? WHERE id = ?').run(zone, userId)
    return c.json(profileOf(db, userId))
  })

  return r
}
