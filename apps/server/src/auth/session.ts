// 세션: 쿠키에는 무작위 토큰, DB(sessions.id)에는 HMAC-SHA256(SESSION_SECRET, 토큰)만 둔다.
// DB 사본이 새도 쿠키를 만들 수 없다. 30일 유효, 남은 기간이 15일 미만이면 다시 30일로 늘린다.
import { createHmac, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import type { Config } from '../config.ts'

export const SESSION_COOKIE = 'nk_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const SESSION_RENEW_MS = 15 * 24 * 60 * 60 * 1000

/** 개발 · 테스트 전용. 운영에서는 loadConfig 가 SESSION_SECRET 없이 시작하지 않는다. */
const DEV_SECRET = 'nakamura-dev-only-session-secret'

const secretOf = (cfg: Config): string => {
  if (cfg.sessionSecret) return cfg.sessionSecret
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET 이 없습니다')
  return DEV_SECRET
}

export const hashToken = (cfg: Config, token: string): string =>
  createHmac('sha256', secretOf(cfg)).update(token).digest('hex')

export interface SessionRow {
  userId: number
  name: string
  isAdmin: boolean
  expiresAt: number
}

/** 새 세션을 만들고 쿠키에 넣을 토큰을 돌려준다. 만료된 세션도 이때 청소한다. */
export const createSession = (db: DatabaseSync, cfg: Config, userId: number, now = Date.now()): string => {
  const token = randomBytes(32).toString('base64url')
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
  db.prepare('INSERT INTO sessions(id, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(cfg, token),
    userId,
    now + SESSION_TTL_MS,
  )
  return token
}

/**
 * 토큰으로 세션을 찾는다. 만료됐으면 지우고 null.
 * 남은 기간이 짧으면 만료를 늘리고 renewed=true (쿠키도 다시 써야 한다).
 */
export const findSession = (
  db: DatabaseSync,
  cfg: Config,
  token: string,
  now = Date.now(),
): { session: SessionRow; renewed: boolean } | null => {
  const id = hashToken(cfg, token)
  const row = db
    .prepare(
      `SELECT u.id AS userId, u.name AS name, u.is_admin AS isAdmin, s.expires_at AS expiresAt
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(id) as { userId: number; name: string; isAdmin: number; expiresAt: number } | undefined
  if (!row) return null
  if (row.expiresAt <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    return null
  }
  let renewed = false
  if (row.expiresAt - now < SESSION_RENEW_MS) {
    row.expiresAt = now + SESSION_TTL_MS
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(row.expiresAt, id)
    renewed = true
  }
  return { session: { ...row, isAdmin: row.isAdmin === 1 }, renewed }
}

export const deleteSession = (db: DatabaseSync, cfg: Config, token: string): void => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(cfg, token))
}

const cookieOpts = (cfg: Config) => ({
  path: cfg.basePath || '/',
  httpOnly: true,
  sameSite: 'Lax' as const,
  secure: cfg.publicUrl.startsWith('https'),
})

export const setSessionCookie = (c: Context, cfg: Config, token: string): void =>
  setCookie(c, SESSION_COOKIE, token, { ...cookieOpts(cfg), maxAge: Math.floor(SESSION_TTL_MS / 1000) })

export const clearSessionCookie = (c: Context, cfg: Config): void => {
  deleteCookie(c, SESSION_COOKIE, cookieOpts(cfg))
}
