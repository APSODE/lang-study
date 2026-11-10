import { describe, expect, it } from 'vitest'
import { log, setup, T0 } from './helpers.ts'

const nick = (u: { send: (m: string, p: string, b: unknown) => Response | Promise<Response> }, displayName: unknown) =>
  Promise.resolve(u.send('PUT', '/me/profile', { displayName }))

describe('닉네임', () => {
  it('바꾸기 · 지우기: 로그인 이름은 그대로, 보이는 이름만 바뀐다', async () => {
    const { db, req, user } = setup({ kana: false })
    const u = await user('hana')
    let res = await nick(u, '하나짱')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'hana', displayName: '하나짱', display: '하나짱' })
    expect(await u.get('/auth/me')).toEqual({ user: { id: u.id, name: 'hana', display: '하나짱', isAdmin: false } })
    // 로그인은 여전히 로그인 이름으로
    expect((await req('POST', '/auth/login', { name: '하나짱', password: 'password1' })).status).toBe(401)
    const login = await req('POST', '/auth/login', { name: 'hana', password: 'password1' })
    expect(await login.json()).toEqual({ user: { id: u.id, name: 'hana', display: '하나짱', isAdmin: false } })

    // undefined 는 그대로, null · "" 은 지운다
    expect(await (await u.send('PUT', '/me/profile', { showProgress: true })).json()).toMatchObject({ displayName: '하나짱' })
    expect(await (await nick(u, '')).json()).toMatchObject({ displayName: null, display: 'hana' })
    await nick(u, 'x1')
    expect(await (await nick(u, null)).json()).toMatchObject({ displayName: null, display: 'hana' })
    expect(db.prepare('SELECT display_name AS d FROM users WHERE id = ?').get(u.id)).toEqual({ d: null })
  })

  it('형식은 가입 이름과 같다 (2–20자 한글 · 영문 · 숫자 · _ · -)', async () => {
    const { user } = setup({ kana: false })
    const u = await user('hana')
    for (const bad of ['a', 'x'.repeat(21), 'has space', 'é-accent', '<b>', 'ab!', 123, true, ['ab']]) {
      expect((await nick(u, bad)).status, JSON.stringify(bad)).toBe(400)
    }
    for (const ok of ['ab', '한글_name-1', 'x'.repeat(20)]) {
      expect((await nick(u, ok)).status, ok).toBe(200)
    }
    // 잘못된 닉네임이면 같이 보낸 다른 값도 바뀌지 않는다
    expect((await u.send('PUT', '/me/profile', { displayName: 'a', showProgress: false })).status).toBe(400)
    expect(await u.get('/me/profile')).toMatchObject({ showProgress: true, displayName: 'x'.repeat(20) })
  })

  it('다른 사람의 닉네임 · 로그인 이름과 겹치면 409 (대소문자 무시), 자기 로그인 이름은 괜찮다', async () => {
    const { user } = setup({ kana: false })
    const hana = await user('hana')
    const yuki = await user('Yuki')
    expect((await nick(hana, 'Neko')).status).toBe(200)

    // hana 의 닉네임을 yuki 가, yuki 의 로그인 이름을 hana 가
    for (const [who, taken] of [[yuki, 'neko'], [yuki, 'NEKO'], [hana, 'yuki'], [hana, 'YUKI']] as const) {
      const res = await nick(who, taken)
      expect(res.status, taken).toBe(409)
      expect(await res.json()).toEqual({ error: '이미 쓰고 있는 이름입니다' })
    }
    // hana 로그인 이름도 yuki 가 닉네임으로 쓸 수 없다
    expect((await nick(yuki, 'HANA')).status).toBe(409)
    // 자기 닉네임 · 자기 로그인 이름은 다시 써도 된다
    expect((await nick(hana, 'neko')).status).toBe(200)
    expect((await nick(yuki, 'yuki')).status).toBe(200)
    expect(await yuki.get('/me/profile')).toMatchObject({ name: 'Yuki', displayName: 'yuki', display: 'yuki' })
  })

  it('가입 이름도 다른 사람의 닉네임과 겹치면 409', async () => {
    const { db, req, user } = setup({ kana: false })
    const hana = await user('hana')
    await nick(hana, 'Neko')
    db.prepare("INSERT INTO invites(code, created_by, expires_at, max_uses, uses, created_at) VALUES ('inv', ?, ?, 5, 0, 0)").run(
      hana.id,
      Date.now() + 86400000,
    )
    expect((await req('POST', '/auth/signup', { invite: 'inv', name: 'neko', password: 'password1' })).status).toBe(409)
    expect((await req('POST', '/auth/signup', { invite: 'inv', name: 'kuro', password: 'password1' })).status).toBe(200)
  })

  it('리더보드 · 친구 · 관리자 화면에 닉네임이 보인다', async () => {
    const { db, user } = setup()
    const boss = await user('boss', { admin: true })
    const hana = await user('hana')
    await nick(hana, '하나짱')
    log(db, hana.id, T0)

    const lb = await boss.get('/social/leaderboard')
    expect(lb.entries.map((e: { name: string }) => e.name)).toEqual(['하나짱', 'boss'])
    const me = await hana.get('/social/leaderboard')
    expect(me.entries.find((e: { isMe: boolean }) => e.isMe).name).toBe('하나짱')

    const { friends } = await boss.get('/social/friends')
    expect(friends.map((f: { name: string }) => f.name)).toEqual(['하나짱'])

    const { users } = await boss.get('/admin/users')
    expect(users.find((x: { id: number }) => x.id === hana.id)).toMatchObject({ name: 'hana', display: '하나짱' })

    await hana.send('POST', '/reports', { noteId: 'kana-hira-a', reason: 'typo' })
    const { reports } = await boss.get('/admin/reports')
    expect(reports[0].userName).toBe('하나짱')
  })
})
