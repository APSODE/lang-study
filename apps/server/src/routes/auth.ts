// 로그인 · 가입 · 초대 API. app.ts 에서 /api 아래에 붙인다.
//   GET    /invites/:code          초대가 유효한지만 알려 준다
//   POST   /auth/signup            { invite, name, password } → 가입 후 로그인
//   POST   /auth/login             { name, password }
//   POST   /auth/logout
//   GET    /auth/me                { user: SessionUser | null }  SessionUser = { id, name(로그인 이름), display(닉네임 ?? name), isAdmin }
//   POST   /auth/password          { current, next } → { ok: true } 다른 기기의 세션은 모두 끊는다 (지금 세션은 유지)
//   POST   /admin/invites          { days?, maxUses? } → 초대 발급
//   GET    /admin/invites          쓸 수 있는 초대 목록
//   DELETE /admin/invites/:code
import type { DatabaseSync } from 'node:sqlite'
import { type Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Config } from '../config.ts'
import {
  checkInviteOptions,
  consumeInvite,
  createInvite,
  deleteInvite,
  findActiveInvite,
  listActiveInvites,
} from '../auth/invites.ts'
import { type AppEnv, requireAdmin, requireUser, type SessionUser } from '../auth/middleware.ts'
import { dummyVerify, hashPassword, verifyPassword } from '../auth/password.ts'
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  hashToken,
  SESSION_COOKIE,
  setSessionCookie,
} from '../auth/session.ts'
import { createThrottle } from '../auth/throttle.ts'
import { checkName, checkPassword, findUserByName, insertUser, nameTaken, PASSWORD_MAX } from '../auth/users.ts'

const INVITE_INVALID = '초대 링크가 만료되었거나 더 이상 쓸 수 없습니다'

/** JSON 객체 본문. 형식이 틀리면 null. */
export const readBody = async (c: Context): Promise<Record<string, unknown> | null> => {
  try {
    const body: unknown = await c.req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * 로그인 제한용 클라이언트 주소. 서버는 127.0.0.1 에만 열고 리버스 프록시 뒤에 두므로,
 * 프록시가 덧붙인 X-Forwarded-For 의 마지막 값을 쓴다. 없으면 'local'.
 */
const clientIp = (c: Context): string =>
  c.req.header('x-forwarded-for')?.split(',').at(-1)?.trim() || 'local'

export const authRoutes = (cfg: Config, db: DatabaseSync) => {
  const r = new Hono<AppEnv>()
  const throttle = createThrottle()

  const logIn = (c: Context<AppEnv>, user: SessionUser) => {
    setSessionCookie(c, cfg, createSession(db, cfg, user.id))
    return c.json({ user })
  }

  r.get('/invites/:code', c => {
    const invite = findActiveInvite(db, c.req.param('code'))
    return c.json(invite ? { valid: true, expiresAt: invite.expiresAt } : { valid: false, expiresAt: null })
  })

  r.post('/auth/signup', async c => {
    const body = await readBody(c)
    if (!body) return c.json({ error: '요청 형식이 올바르지 않습니다' }, 400)
    const { invite, name, password } = body
    if (typeof invite !== 'string' || invite === '') return c.json({ error: '초대 코드가 없습니다' }, 400)
    const problem = checkName(name) ?? checkPassword(password)
    if (problem) return c.json({ error: problem }, 400)
    // 아래 두 검사는 해시 계산 전에 빨리 거르는 용도. 확정은 트랜잭션 안에서 다시 한다.
    if (!findActiveInvite(db, invite)) return c.json({ error: INVITE_INVALID }, 410)
    // 다른 사람의 닉네임과도 겹치면 안 된다 (보이는 이름이 같아지므로)
    if (nameTaken(db, name as string)) return c.json({ error: '이미 쓰고 있는 이름입니다' }, 409)

    const hash = await hashPassword(password as string)
    const now = Date.now()
    let id: number
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!consumeInvite(db, invite, now)) {
        db.exec('ROLLBACK')
        return c.json({ error: INVITE_INVALID }, 410)
      }
      if (nameTaken(db, name as string)) {
        db.exec('ROLLBACK')
        return c.json({ error: '이미 쓰고 있는 이름입니다' }, 409)
      }
      id = insertUser(db, name as string, hash, false, now)
      db.exec('COMMIT')
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw err
    }
    return logIn(c, { id, name: name as string, display: name as string, isAdmin: false })
  })

  r.post('/auth/login', async c => {
    const body = await readBody(c)
    const name = body?.name
    const password = body?.password
    if (typeof name !== 'string' || typeof password !== 'string' || name === '' || password === '') {
      return c.json({ error: '이름과 비밀번호를 입력하세요' }, 400)
    }
    const key = `${clientIp(c)}|${name.toLowerCase()}`
    const wait = throttle.blockedFor(key)
    if (wait > 0) {
      c.header('Retry-After', String(wait))
      return c.json({ error: `로그인 시도가 너무 많습니다. ${Math.ceil(wait / 60)}분 뒤에 다시 시도하세요` }, 429)
    }
    const user = password.length <= PASSWORD_MAX ? findUserByName(db, name) : null
    const ok = user ? await verifyPassword(password, user.passwordHash) : (await dummyVerify(password), false)
    if (!user || !ok) {
      throttle.fail(key)
      return c.json({ error: '이름 또는 비밀번호가 올바르지 않습니다' }, 401)
    }
    throttle.reset(key)
    return logIn(c, { id: user.id, name: user.name, display: user.display, isAdmin: user.isAdmin })
  })

  r.post('/auth/logout', c => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) deleteSession(db, cfg, token)
    clearSessionCookie(c, cfg)
    return c.json({ ok: true })
  })

  r.get('/auth/me', c => c.json({ user: c.get('user') }))

  r.use('/auth/password', requireUser)
  r.post('/auth/password', async c => {
    const body = await readBody(c)
    const current = body?.current
    const next = body?.next
    if (typeof current !== 'string' || current === '') return c.json({ error: '지금 비밀번호를 입력하세요' }, 400)
    const problem = checkPassword(next)
    if (problem) return c.json({ error: problem }, 400)
    const user = c.get('user')!
    // 세션을 가진 사람이 지금 비밀번호를 맞혀 보지 못하게 로그인과 같은 제한을 둔다 (사용자별)
    const key = `password|${user.id}`
    const wait = throttle.blockedFor(key)
    if (wait > 0) {
      c.header('Retry-After', String(wait))
      return c.json({ error: `시도가 너무 많습니다. ${Math.ceil(wait / 60)}분 뒤에 다시 시도하세요` }, 429)
    }
    const row = db.prepare('SELECT password_hash AS hash FROM users WHERE id = ?').get(user.id) as { hash: string }
    if (current.length > PASSWORD_MAX || !(await verifyPassword(current, row.hash))) {
      throttle.fail(key)
      return c.json({ error: '지금 비밀번호가 올바르지 않습니다' }, 401)
    }
    throttle.reset(key)
    const hash = await hashPassword(next as string)
    const keep = hashToken(cfg, getCookie(c, SESSION_COOKIE)!)
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id)
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, keep)
      db.exec('COMMIT')
    } catch (err) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw err
    }
    return c.json({ ok: true })
  })

  r.use('/admin/*', requireAdmin)

  r.post('/admin/invites', async c => {
    const body = await readBody(c)
    if (!body) return c.json({ error: '요청 형식이 올바르지 않습니다' }, 400)
    const { days, maxUses } = body
    const problem = checkInviteOptions(days, maxUses)
    if (problem) return c.json({ error: problem }, 400)
    const invite = createInvite(db, cfg, c.get('user')!.id, days as number | undefined, maxUses as number | undefined)
    return c.json({ code: invite.code, url: invite.url, expiresAt: invite.expiresAt, maxUses: invite.maxUses }, 201)
  })

  r.get('/admin/invites', c => c.json({ invites: listActiveInvites(db, cfg) }))

  r.delete('/admin/invites/:code', c =>
    deleteInvite(db, c.req.param('code')) ? c.json({ ok: true }) : c.json({ error: '없는 초대입니다' }, 404),
  )

  return r
}
