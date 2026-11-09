// 인증 미들웨어. 라우트는 c.get('user') 로 로그인한 사용자를 얻는다.
//   api.use('*', loadUser(db, cfg))       모든 요청에서 세션 쿠키를 읽는다 (없으면 user = null)
//   route.use('/x/*', requireUser)         로그인 필요 (401)
//   route.use('/admin/*', requireAdmin)    관리자 필요 (로그인 안 됨 401, 관리자 아님 403)
import type { DatabaseSync } from 'node:sqlite'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { Config } from '../config.ts'
import { clearSessionCookie, findSession, SESSION_COOKIE, setSessionCookie } from './session.ts'

export type SessionUser = { id: number; name: string; isAdmin: boolean }

export type AppEnv = { Variables: { user: SessionUser | null } }

export const loadUser = (db: DatabaseSync, cfg: Config) =>
  createMiddleware<AppEnv>(async (c, next) => {
    c.set('user', null)
    const token = getCookie(c, SESSION_COOKIE)
    if (token) {
      const found = findSession(db, cfg, token)
      if (found) {
        const { userId, name, isAdmin } = found.session
        c.set('user', { id: userId, name, isAdmin })
        if (found.renewed) setSessionCookie(c, cfg, token)
      } else {
        clearSessionCookie(c, cfg)
      }
    }
    await next()
  })

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) return c.json({ error: '로그인이 필요합니다' }, 401)
  await next()
})

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: '로그인이 필요합니다' }, 401)
  if (!user.isAdmin) return c.json({ error: '관리자만 할 수 있습니다' }, 403)
  await next()
})
