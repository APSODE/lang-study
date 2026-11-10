import { describe, expect, it } from 'vitest'
import { publishedCatalog } from '../src/study/catalog.ts'
import { DAY, kst, log, right, setup, T0 } from './helpers.ts'

describe('로그인 필요', () => {
  it('새 API 는 모두 401', async () => {
    const { req } = setup({ kana: false })
    for (const [m, p] of [
      ['GET', '/stats/activity'],
      ['GET', '/stats/tracks'],
      ['GET', '/social/leaderboard'],
      ['GET', '/social/friends'],
      ['GET', '/me/profile'],
      ['PUT', '/me/profile'],
      ['POST', '/auth/password'],
      ['GET', '/admin/reports'],
      ['PATCH', '/admin/reports/1'],
      ['GET', '/admin/users'],
    ] as const) {
      expect((await req(m, p, m === 'GET' ? undefined : {})).status, `${m} ${p}`).toBe(401)
    }
  })
})

describe('활동 (날마다 복습 수)', () => {
  it('기본 84일, 오늘로 끝나고 복습 없는 날도 0 으로 채운다', async () => {
    const { user } = setup({ kana: false })
    const u = await user('hana')
    const { days } = await u.get('/stats/activity')
    expect(days).toHaveLength(84)
    expect(days.at(-1)).toEqual({ day: '2026-11-09', reviews: 0, correct: 0 })
    expect(days[0].day).toBe('2026-08-18')
    expect(days.every((d: { reviews: number }) => d.reviews === 0)).toBe(true)
    // 날짜는 하루씩, 오래된 것부터
    for (let k = 1; k < days.length; k++) expect(Date.parse(days[k].day) - Date.parse(days[k - 1].day)).toBe(DAY)
    expect((await u.get('/stats/activity?days=1')).days).toEqual([{ day: '2026-11-09', reviews: 0, correct: 0 }])
    expect((await u.get('/stats/activity?days=366')).days).toHaveLength(366)
  })

  it('days 는 1–366 정수', async () => {
    const { user } = setup({ kana: false })
    const u = await user('hana')
    for (const d of ['0', '367', '1.5', 'x', '-3']) {
      expect((await u.send('GET', `/stats/activity?days=${d}`, undefined)).status, d).toBe(400)
    }
  })

  it('03:59 복습은 전날, 04:00 복습은 그날. 맞힌 수도 센다', async () => {
    const { db, clock, user } = setup()
    const u = await user('hana')
    clock.now = kst('2026-11-09T03:59:00')
    expect((await u.answer('kana-hira-a:kana-to-romaji', 'a')).status).toBe(200)
    clock.now = kst('2026-11-09T04:00:00')
    expect((await u.answer('kana-hira-i:kana-to-romaji', 'x')).status).toBe(200) // 틀림
    expect((await u.answer('kana-hira-u:kana-to-romaji', right(db, 'kana-hira-u:kana-to-romaji'))).status).toBe(200)
    log(db, u.id, kst('2026-11-01T12:00:00')) // 창 밖 (days=3 이면 11-07 부터)
    clock.now = T0
    expect((await u.get('/stats/activity?days=3')).days).toEqual([
      { day: '2026-11-07', reviews: 0, correct: 0 },
      { day: '2026-11-08', reviews: 1, correct: 1 },
      { day: '2026-11-09', reviews: 2, correct: 1 },
    ])
  })

  it('사용자 시간대 기준으로 자른다', async () => {
    const { db, user } = setup({ kana: false })
    const u = await user('hana', { tz: 'America/New_York' })
    // T0 = 2026-11-09 01:00Z = 뉴욕 11-08 20:00 → 학습일 11-08
    log(db, u.id, Date.parse('2026-11-08T08:59:00Z')) // 뉴욕 03:59 → 11-07
    log(db, u.id, Date.parse('2026-11-08T09:00:00Z')) // 뉴욕 04:00 → 11-08
    expect((await u.get('/stats/activity?days=2')).days.map((d: { day: string; reviews: number }) => [d.day, d.reviews])).toEqual([
      ['2026-11-07', 1],
      ['2026-11-08', 1],
    ])
  })
})

describe('트랙별 카드 상태', () => {
  it('처음에는 모든 카드가 아직 안 본 카드, 정답률은 null', async () => {
    const { db, user } = setup()
    const u = await user('hana')
    const total = publishedCatalog(db, 'kana').notes.reduce((n, c) => n + c.drills.length, 0)
    const { tracks } = await u.get('/stats/tracks')
    expect(tracks.map((t: { track: string }) => t.track)).toEqual(['kana', 'kanji', 'toeic', 'toefl'])
    expect(tracks[0]).toEqual({
      track: 'kana',
      notes: 208,
      cards: total,
      unseen: total,
      learning: 0,
      young: 0,
      mature: 0,
      accuracy7d: null,
    })
    expect(tracks[1]).toEqual({ track: 'kanji', notes: 0, cards: 0, unseen: 0, learning: 0, young: 0, mature: 0, accuracy7d: null })
  })

  it('배우는 중 · 복습 중(21일 미만) · 익힘(21일 이상), 일시 중지 · 비공개 카드는 빼고 센다', async () => {
    const { db, user } = setup()
    const u = await user('hana')
    const ids = ['a', 'i', 'u', 'e', 'o'].map(r => `kana-hira-${r}:kana-to-romaji`)
    for (const id of ids) expect((await u.answer(id, id === ids[0] ? 'x' : right(db, id))).status).toBe(200)
    const set = (id: string, state: number, ivl: number) =>
      db.prepare("UPDATE user_cards SET fsrs = json_set(fsrs, '$.state', ?, '$.scheduled_days', ?) WHERE card_id = ?").run(state, ivl, id)
    set(ids[1]!, 2, 20) // 복습 중
    set(ids[2]!, 2, 21) // 익힘
    set(ids[3]!, 3, 1) // 다시 배우는 중
    db.prepare('UPDATE user_cards SET suspended = 1 WHERE card_id = ?').run(ids[4]!)
    const before = publishedCatalog(db, 'kana').notes.reduce((n, c) => n + c.drills.length, 0)

    let kana = (await u.get('/stats/tracks')).tracks[0]
    expect(kana).toMatchObject({ notes: 208, cards: before - 1, unseen: before - 5, learning: 2, young: 1, mature: 1 })
    expect(kana.accuracy7d).toBeCloseTo(3 / 4) // o 는 일시 중지라 빠진다

    // 노트를 내리면 그 노트의 카드는 어디에도 세지 않는다 (복습 기록도 정답률에서 빠진다)
    db.prepare("UPDATE notes SET status = 'retired', updated_at = updated_at + 1 WHERE id = 'kana-hira-u'").run()
    kana = (await u.get('/stats/tracks')).tracks[0]
    const after = publishedCatalog(db, 'kana').notes.reduce((n, c) => n + c.drills.length, 0)
    expect(after).toBe(before - 3)
    expect(kana).toMatchObject({ notes: 207, cards: after - 1, unseen: after - 4, learning: 2, young: 1, mature: 0 })
    expect(kana.accuracy7d).toBeCloseTo(2 / 3) // a(틀림) i e 만. o 는 일시 중지
  })

  it('정답률은 오늘 포함 최근 7 학습일', async () => {
    const { db, clock, user } = setup()
    const u = await user('hana')
    await u.answer('kana-hira-a:kana-to-romaji', 'a')
    clock.now = kst('2026-11-15T23:00:00')
    expect((await u.get('/stats/tracks')).tracks[0].accuracy7d).toBe(1)
    clock.now = kst('2026-11-16T03:59:00') // 아직 11-15 학습일
    expect((await u.get('/stats/tracks')).tracks[0].accuracy7d).toBe(1)
    clock.now = kst('2026-11-16T04:00:00')
    expect((await u.get('/stats/tracks')).tracks[0].accuracy7d).toBeNull()
  })
})
