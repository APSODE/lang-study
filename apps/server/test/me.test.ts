import { describe, expect, it } from 'vitest'
import { PASSWORD, setup } from './helpers.ts'

describe('내 정보', () => {
  it('조회 · 공개 설정 · 시간대 변경', async () => {
    const { db, user } = setup({ kana: false })
    const u = await user('hana')
    const createdAt = (db.prepare('SELECT created_at AS t FROM users WHERE id = ?').get(u.id) as { t: number }).t
    expect(await u.get('/me/profile')).toEqual({ name: 'hana', displayName: null, display: 'hana', isAdmin: false, showProgress: true, tz: 'Asia/Seoul', createdAt })

    let res = await u.send('PUT', '/me/profile', { showProgress: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ showProgress: false, tz: 'Asia/Seoul' })

    res = await u.send('PUT', '/me/profile', { tz: 'Europe/Paris' })
    expect(await res.json()).toMatchObject({ showProgress: false, tz: 'Europe/Paris' })
    // 대소문자 · 별칭은 정식 이름으로 저장
    res = await u.send('PUT', '/me/profile', { tz: 'asia/tokyo', showProgress: true })
    expect(await res.json()).toMatchObject({ showProgress: true, tz: 'Asia/Tokyo' })
    expect(db.prepare('SELECT tz, show_progress AS s FROM users WHERE id = ?').get(u.id)).toEqual({ tz: 'Asia/Tokyo', s: 1 })

    // 빈 본문은 그대로
    expect(await (await u.send('PUT', '/me/profile', {})).json()).toMatchObject({ showProgress: true, tz: 'Asia/Tokyo' })
  })

  it('잘못된 시간대 · 값은 400, 바뀌지 않는다', async () => {
    const { user } = setup({ kana: false })
    const u = await user('hana')
    for (const body of [
      { tz: 'Not/AZone' },
      { tz: '+09:00' },
      { tz: '' },
      { tz: 123 },
      { tz: 'x'.repeat(100) },
      { showProgress: 'yes' },
      { showProgress: 0 },
      { showProgress: false, tz: 'Mars/Base' },
    ]) {
      expect((await u.send('PUT', '/me/profile', body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await u.send('PUT', '/me/profile', [1])).status).toBe(400)
    expect(await u.get('/me/profile')).toMatchObject({ showProgress: true, tz: 'Asia/Seoul' })
  })
})

describe('비밀번호 변경', () => {
  it('지금 비밀번호가 틀리면 401, 맞으면 바꾸고 다른 세션만 끊는다', async () => {
    const { req, signIn, as, user } = setup({ kana: false })
    const u = await user('hana')
    const other = as(await signIn('hana'), u.id, 'hana')
    const me = async (cookie: string) => (await (await req('GET', '/auth/me', undefined, cookie)).json()).user

    expect((await u.send('POST', '/auth/password', { current: 'wrong-pass', next: 'newpassword1' })).status).toBe(401)
    expect((await u.send('POST', '/auth/password', { current: PASSWORD, next: 'short' })).status).toBe(400)
    expect((await u.send('POST', '/auth/password', { next: 'newpassword1' })).status).toBe(400)
    // 아직 둘 다 로그인 상태
    expect(await me(other.cookie)).toMatchObject({ name: 'hana' })

    const res = await u.send('POST', '/auth/password', { current: PASSWORD, next: 'newpassword1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await me(u.cookie)).toMatchObject({ name: 'hana' })
    expect(await me(other.cookie)).toBeNull()

    expect((await req('POST', '/auth/login', { name: 'hana', password: PASSWORD })).status).toBe(401)
    expect((await req('POST', '/auth/login', { name: 'hana', password: 'newpassword1' })).status).toBe(200)
  })

  it('틀린 시도가 많으면 막는다 (429)', async () => {
    const { user } = setup({ kana: false })
    const u = await user('hana')
    for (let k = 0; k < 10; k++) {
      expect((await u.send('POST', '/auth/password', { current: `wrong-${k}`, next: 'newpassword1' })).status).toBe(401)
    }
    const res = await u.send('POST', '/auth/password', { current: PASSWORD, next: 'newpassword1' })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
  })
})
