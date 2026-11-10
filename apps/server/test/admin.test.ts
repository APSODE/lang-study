import { describe, expect, it } from 'vitest'
import { kst, log, setup, T0 } from './helpers.ts'

describe('관리자 권한', () => {
  it('일반 사용자는 403', async () => {
    const { user } = setup({ kana: false })
    const u = await user('hana')
    expect((await u.send('GET', '/admin/reports', undefined)).status).toBe(403)
    expect((await u.send('GET', '/admin/users', undefined)).status).toBe(403)
    expect((await u.send('PATCH', '/admin/reports/1', { status: 'resolved' })).status).toBe(403)
  })
})

describe('신고 처리', () => {
  it('목록 (최근 것부터, 노트 내용 포함) · 처리 · 거절 · 다시 열기', async () => {
    const { clock, user } = setup()
    const admin = await user('boss', { admin: true })
    const hana = await user('hana')
    clock.now = T0
    const first = (await (await hana.send('POST', '/reports', { noteId: 'kana-hira-a', reason: 'typo' })).json()).id
    clock.now = T0 + 1000
    const second = (
      await (
        await hana.send('POST', '/reports', {
          noteId: 'kana-hira-i',
          cardId: 'kana-hira-i:kana-listen',
          reason: 'audio',
          body: '소리가 작아요',
        })
      ).json()
    ).id

    let { reports } = await admin.get('/admin/reports')
    expect(reports.map((r: { id: number }) => r.id)).toEqual([second, first])
    expect(reports[0]).toEqual({
      id: second,
      noteId: 'kana-hira-i',
      cardId: 'kana-hira-i:kana-listen',
      userName: 'hana',
      reason: 'audio',
      body: '소리가 작아요',
      status: 'open',
      createdAt: T0 + 1000,
      resolvedAt: null,
      resolvedBy: null,
      note: { track: 'kana', fields: expect.objectContaining({ char: 'い', romaji: 'i' }), status: 'published' },
    })
    expect(reports[1]).toMatchObject({ cardId: null, body: null, reason: 'typo' })

    clock.now = T0 + 5000
    let res = await admin.send('PATCH', `/admin/reports/${first}`, { status: 'resolved' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: first, status: 'resolved', resolvedAt: T0 + 5000, resolvedBy: 'boss' })

    expect((await admin.get('/admin/reports')).reports.map((r: { id: number }) => r.id)).toEqual([second])
    expect((await admin.get('/admin/reports?status=resolved')).reports.map((r: { id: number }) => r.id)).toEqual([first])
    expect((await admin.get('/admin/reports?status=all')).reports.map((r: { id: number }) => r.id)).toEqual([second, first])

    res = await admin.send('PATCH', `/admin/reports/${second}`, { status: 'rejected' })
    expect(await res.json()).toMatchObject({ status: 'rejected', resolvedBy: 'boss' })
    expect((await admin.get('/admin/reports?status=rejected')).reports).toHaveLength(1)

    res = await admin.send('PATCH', `/admin/reports/${first}`, { status: 'open' })
    expect(await res.json()).toMatchObject({ status: 'open', resolvedAt: null, resolvedBy: null })
    ;({ reports } = await admin.get('/admin/reports'))
    expect(reports.map((r: { id: number }) => r.id)).toEqual([first])
  })

  it('없는 신고는 404, 잘못된 상태는 400', async () => {
    const { user } = setup({ kana: false })
    const admin = await user('boss', { admin: true })
    expect((await admin.send('PATCH', '/admin/reports/999', { status: 'resolved' })).status).toBe(404)
    expect((await admin.send('PATCH', '/admin/reports/abc', { status: 'resolved' })).status).toBe(404)
    expect((await admin.send('PATCH', '/admin/reports/1', { status: 'done' })).status).toBe(400)
    expect((await admin.send('GET', '/admin/reports?status=done', undefined)).status).toBe(400)
  })
})

describe('사용자 목록', () => {
  it('모든 사용자 (공개를 끈 사용자 포함)', async () => {
    const { db, user } = setup({ kana: false })
    const admin = await user('boss', { admin: true })
    const hana = await user('hana', { hidden: true })
    log(db, hana.id, kst('2026-11-08T12:00:00')) // 지난주
    log(db, hana.id, T0)
    const { users } = await admin.get('/admin/users')
    expect(users).toEqual([
      { id: admin.id, name: 'boss', display: 'boss', isAdmin: true, createdAt: expect.any(Number), lastStudiedDay: null, reviewsWeek: 0, showProgress: true },
      { id: hana.id, name: 'hana', display: 'hana', isAdmin: false, createdAt: expect.any(Number), lastStudiedDay: '2026-11-09', reviewsWeek: 1, showProgress: false },
    ])
  })
})
