import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { createInvite } from '../src/auth/invites.ts'
import { hashPassword, verifyPassword } from '../src/auth/password.ts'
import { SESSION_RENEW_MS } from '../src/auth/session.ts'
import { insertUser } from '../src/auth/users.ts'
import { ensureDataDirs, loadConfig } from '../src/config.ts'
import { openDb } from '../src/db.ts'

const setup = (env: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'nakamura-auth-'))
  const cfg = loadConfig({ DATA_DIR: join(dir, 'data'), WEB_DIST: join(dir, 'web'), ...env })
  ensureDataDirs(cfg)
  const db = openDb(cfg.dbPath)
  const app = createApp(cfg, db)
  const base = cfg.basePath

  const req = (method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) =>
    app.request(`${base}/api${path}`, {
      method,
      headers: {
        ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  /** Set-Cookie 에서 'nk_session=...' 부분만 */
  const sessionCookie = (res: Response): string | undefined =>
    res.headers
      .getSetCookie()
      .find(s => s.startsWith('nk_session='))
      ?.split(';')[0]

  const admin = async (name = 'admin', password = 'admin-password') => {
    const id = insertUser(db, name, await hashPassword(password), true)
    const res = await req('POST', '/auth/login', { name, password })
    return { id, cookie: sessionCookie(res)! }
  }

  return { cfg, db, app, req, sessionCookie, admin }
}

const inviteFor = (db: DatabaseSync, cfg: ReturnType<typeof loadConfig>, adminId: number, days = 7, maxUses = 1) =>
  createInvite(db, cfg, adminId, days, maxUses).code

describe('비밀번호 해시', () => {
  it('자기 설명 형식이고 맞는 비밀번호만 통과한다', async () => {
    const h = await hashPassword('correct horse')
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(await verifyPassword('correct horse', h)).toBe(true)
    expect(await verifyPassword('wrong horse', h)).toBe(false)
    expect(await verifyPassword('x', 'garbage')).toBe(false)
    expect(await hashPassword('correct horse')).not.toBe(h)
  })
})

describe('초대 가입', () => {
  it('유효한 초대로 가입하면 로그인되고 초대가 소진된다', async () => {
    const { db, cfg, req, sessionCookie, admin } = setup()
    const a = await admin()
    const code = inviteFor(db, cfg, a.id)

    const check = await (await req('GET', `/invites/${code}`)).json()
    expect(check).toMatchObject({ valid: true })
    expect(typeof check.expiresAt).toBe('number')

    const res = await req('POST', '/auth/signup', { invite: code, name: '하나', password: 'password1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: { id: expect.any(Number), name: '하나', display: '하나', isAdmin: false } })
    const cookie = sessionCookie(res)!
    expect(cookie).toBeTruthy()
    expect(await (await req('GET', '/auth/me', undefined, cookie)).json()).toMatchObject({ user: { name: '하나' } })

    // 1회용이므로 이제 무효
    expect(await (await req('GET', `/invites/${code}`)).json()).toEqual({ valid: false, expiresAt: null })
    const again = await req('POST', '/auth/signup', { invite: code, name: 'dul', password: 'password2' })
    expect(again.status).toBe(410)
    expect((await again.json()).error).toContain('초대')
    expect(db.prepare("SELECT count(*) AS n FROM users WHERE name = 'dul'").get()).toEqual({ n: 0 })
  })

  it('여러 번 쓸 수 있는 초대는 횟수만큼만 쓴다', async () => {
    const { db, cfg, req, admin } = setup()
    const a = await admin()
    const code = inviteFor(db, cfg, a.id, 7, 2)
    expect((await req('POST', '/auth/signup', { invite: code, name: 'u1', password: 'password1' })).status).toBe(200)
    expect((await req('POST', '/auth/signup', { invite: code, name: 'u2', password: 'password1' })).status).toBe(200)
    expect((await req('POST', '/auth/signup', { invite: code, name: 'u3', password: 'password1' })).status).toBe(410)
    expect(db.prepare('SELECT uses FROM invites WHERE code = ?').get(code)).toEqual({ uses: 2 })
  })

  it('만료된 초대 · 없는 초대는 거절한다', async () => {
    const { db, req, admin } = setup()
    const a = await admin()
    db.prepare("INSERT INTO invites(code, created_by, expires_at, max_uses, uses, created_at) VALUES ('old', ?, ?, 1, 0, 0)").run(
      a.id,
      Date.now() - 1000,
    )
    expect(await (await req('GET', '/invites/old')).json()).toEqual({ valid: false, expiresAt: null })
    expect((await req('POST', '/auth/signup', { invite: 'old', name: 'late', password: 'password1' })).status).toBe(410)
    expect((await req('POST', '/auth/signup', { invite: 'nope', name: 'late', password: 'password1' })).status).toBe(410)
  })

  it('중복 이름(대소문자 무시)은 409 이고 초대를 소진하지 않는다', async () => {
    const { db, cfg, req, admin } = setup()
    const a = await admin('Hana')
    const code = inviteFor(db, cfg, a.id)
    const res = await req('POST', '/auth/signup', { invite: code, name: 'hana', password: 'password1' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('이미 쓰고 있는 이름입니다')
    expect(db.prepare('SELECT uses FROM invites WHERE code = ?').get(code)).toEqual({ uses: 0 })
  })

  it('이름 · 비밀번호 규칙', async () => {
    const { db, cfg, req, admin } = setup()
    const a = await admin()
    const code = inviteFor(db, cfg, a.id)
    for (const name of ['a', 'x'.repeat(21), 'has space', 'semi;colon', 'カナ']) {
      const res = await req('POST', '/auth/signup', { invite: code, name, password: 'password1' })
      expect(res.status, name).toBe(400)
      expect((await res.json()).error).toContain('이름')
    }
    for (const password of ['short', 'x'.repeat(129), 12345678]) {
      const res = await req('POST', '/auth/signup', { invite: code, name: 'okname', password })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('비밀번호')
    }
    expect((await req('POST', '/auth/signup', { invite: code, name: '한글_name-1', password: 'x'.repeat(128) })).status).toBe(200)
  })
})

describe('로그인 · 로그아웃', () => {
  it('맞는 비밀번호로 로그인, 틀리면 401', async () => {
    const { req, sessionCookie, admin } = setup()
    await admin('Boss', 'right-password')
    const bad = await req('POST', '/auth/login', { name: 'Boss', password: 'wrong-password' })
    expect(bad.status).toBe(401)
    expect(sessionCookie(bad)).toBeUndefined()
    expect((await req('POST', '/auth/login', { name: 'ghost', password: 'whatever1' })).status).toBe(401)
    // 이름은 대소문자 구분 없이 찾는다
    const ok = await req('POST', '/auth/login', { name: 'boss', password: 'right-password' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ user: { id: expect.any(Number), name: 'Boss', display: 'Boss', isAdmin: true } })
  })

  it('10번 틀리면 429, 다른 이름은 영향 없음', async () => {
    const { req, db } = setup()
    insertUser(db, 'target', await hashPassword('right-password'))
    insertUser(db, 'other', await hashPassword('right-password'))
    for (let i = 0; i < 10; i++) {
      expect((await req('POST', '/auth/login', { name: 'target', password: `wrong-${i}xx` })).status).toBe(401)
    }
    const blocked = await req('POST', '/auth/login', { name: 'TARGET', password: 'right-password' })
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await req('POST', '/auth/login', { name: 'other', password: 'right-password' })).status).toBe(200)
  })

  it('me 와 로그아웃', async () => {
    const { req, db, admin } = setup()
    expect(await (await req('GET', '/auth/me')).json()).toEqual({ user: null })
    const { cookie } = await admin()
    expect(await (await req('GET', '/auth/me', undefined, cookie)).json()).toMatchObject({ user: { name: 'admin', isAdmin: true } })

    const out = await req('POST', '/auth/logout', {}, cookie)
    expect(out.status).toBe(200)
    expect(out.headers.getSetCookie().join()).toMatch(/nk_session=;.*Max-Age=0/)
    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 })
    expect(await (await req('GET', '/auth/me', undefined, cookie)).json()).toEqual({ user: null })
  })

  it('DB 에는 토큰이 아니라 HMAC 만 저장한다', async () => {
    const { db, admin } = setup()
    const { cookie } = await admin()
    const token = cookie.split('=')[1]!
    const rows = db.prepare('SELECT id FROM sessions').all() as { id: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0]!.id).not.toContain(token)
  })

  it('만료가 가까우면 늘리고, 지나면 로그아웃된다', async () => {
    const { db, req, sessionCookie, admin } = setup()
    const { cookie } = await admin()
    db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() + SESSION_RENEW_MS - 60_000)
    const res = await req('GET', '/auth/me', undefined, cookie)
    expect(sessionCookie(res)).toBe(cookie)
    const { expires_at } = db.prepare('SELECT expires_at FROM sessions').get() as { expires_at: number }
    expect(expires_at).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000)

    // 충분히 남았으면 쿠키를 다시 쓰지 않는다
    expect(sessionCookie(await req('GET', '/auth/me', undefined, cookie))).toBeUndefined()

    db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1)
    expect(await (await req('GET', '/auth/me', undefined, cookie)).json()).toEqual({ user: null })
    expect(db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })
})

describe('쿠키 속성', () => {
  it('기본: HttpOnly, SameSite=Lax, Path=/, 30일, Secure 없음', async () => {
    const { req, db } = setup()
    insertUser(db, 'user', await hashPassword('password1'))
    const res = await req('POST', '/auth/login', { name: 'user', password: 'password1' })
    const sc = res.headers.getSetCookie().find(s => s.startsWith('nk_session='))!
    expect(sc).toMatch(/nk_session=[A-Za-z0-9_-]{43};/)
    expect(sc).toContain('HttpOnly')
    expect(sc).toContain('SameSite=Lax')
    expect(sc).toContain('Path=/;')
    expect(sc).toContain(`Max-Age=${30 * 24 * 3600}`)
    expect(sc).not.toContain('Secure')
  })

  it('https PUBLIC_URL 이면 Secure, BASE_PATH 가 있으면 Path 도 그에 맞춘다', async () => {
    const { req, db } = setup({ PUBLIC_URL: 'https://example.com', BASE_PATH: '/lang' })
    insertUser(db, 'user', await hashPassword('password1'))
    const res = await req('POST', '/auth/login', { name: 'user', password: 'password1' })
    const sc = res.headers.getSetCookie().find(s => s.startsWith('nk_session='))!
    expect(sc).toContain('Secure')
    expect(sc).toContain('Path=/lang')
  })
})

describe('관리자 API', () => {
  it('로그인 안 함 401, 일반 사용자 403', async () => {
    const { db, cfg, req, sessionCookie, admin } = setup()
    const a = await admin()
    const code = inviteFor(db, cfg, a.id)
    const user = sessionCookie(await req('POST', '/auth/signup', { invite: code, name: 'normal', password: 'password1' }))!
    for (const [method, path] of [
      ['GET', '/admin/invites'],
      ['POST', '/admin/invites'],
      ['DELETE', `/admin/invites/${code}`],
    ] as const) {
      const body = method === 'GET' ? undefined : {}
      expect((await req(method, path, body)).status, `${method} ${path}`).toBe(401)
      expect((await req(method, path, body, user)).status, `${method} ${path}`).toBe(403)
    }
  })

  it('초대 발급 · 목록 · 삭제', async () => {
    const { req, admin } = setup({ PUBLIC_URL: 'https://example.com', BASE_PATH: '/lang' })
    const { cookie } = await admin()
    const created = await req('POST', '/admin/invites', {}, cookie)
    expect(created.status).toBe(201)
    const inv = await created.json()
    expect(inv.code).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    expect(inv.url).toBe(`https://example.com/lang/#/join/${inv.code}`)
    expect(inv.maxUses).toBe(1)
    expect(inv.expiresAt - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000)

    const second = await (await req('POST', '/admin/invites', { days: 30, maxUses: 20 }, cookie)).json()
    expect(second.maxUses).toBe(20)

    for (const bad of [{ days: 0 }, { days: 31 }, { days: 1.5 }, { maxUses: 21 }, { maxUses: '3' }]) {
      const res = await req('POST', '/admin/invites', bad, cookie)
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }

    const list = (await (await req('GET', '/admin/invites', undefined, cookie)).json()).invites
    expect(list.map((i: { code: string }) => i.code).sort()).toEqual([inv.code, second.code].sort())
    expect(list[0]).toMatchObject({ uses: 0, url: expect.stringContaining('/#/join/') })

    expect((await req('DELETE', `/admin/invites/${inv.code}`, undefined, cookie)).status).toBe(200)
    expect((await req('DELETE', `/admin/invites/${inv.code}`, undefined, cookie)).status).toBe(404)
    expect(await (await req('GET', `/invites/${inv.code}`)).json()).toEqual({ valid: false, expiresAt: null })
  })
})

describe('CSRF: 상태를 바꾸는 요청은 JSON 만', () => {
  it('application/json 이 아니면 415', async () => {
    const { req, db } = setup()
    insertUser(db, 'user', await hashPassword('password1'))
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await req('POST', '/auth/login', undefined, undefined, { 'content-type': type })
      expect(res.status, type).toBe(415)
    }
    const noType = await req('POST', '/auth/logout', undefined, undefined, { 'content-type': '' })
    expect(noType.status).toBe(415)
    const withCharset = await req('POST', '/auth/login', { name: 'user', password: 'password1' }, undefined, {
      'content-type': 'application/json; charset=utf-8',
    })
    expect(withCharset.status).toBe(200)
  })

  it('JSON 이 깨져 있으면 400', async () => {
    const { app } = setup()
    const res = await app.request('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBeTruthy()
  })
})
