import { describe, expect, it } from 'vitest'
import { HOUR, kst, log, right, setup, T0 } from './helpers.ts'

type Entry = { rank: number; userId: number; name: string; reviews: number; streak: number; isMe: boolean }
const brief = (entries: Entry[]) => entries.map(e => [e.rank, e.name, e.reviews, e.streak, e.isMe])

describe('리더보드', () => {
  it('공개를 끈 사용자는 다른 사람에게 안 보이고 자기 자리는 보인다', async () => {
    const { db, user } = setup({ kana: false })
    const hana = await user('hana')
    const yuki = await user('yuki')
    const ken = await user('ken', { hidden: true })
    for (let k = 0; k < 3; k++) log(db, hana.id, T0 - k * 1000)
    log(db, yuki.id, T0)
    for (let k = 0; k < 5; k++) log(db, ken.id, T0 - k * 1000)

    const h = await hana.get('/social/leaderboard')
    expect(h.period).toBe('week')
    expect(brief(h.entries)).toEqual([
      [1, 'hana', 3, 1, true],
      [2, 'yuki', 1, 1, false],
    ])
    expect(h.entries[0].userId).toBe(hana.id)

    const k = await ken.get('/social/leaderboard')
    expect(brief(k.entries)).toEqual([
      [1, 'ken', 5, 1, true],
      [2, 'hana', 3, 1, false],
      [3, 'yuki', 1, 1, false],
    ])
  })

  it('복습 수 → 연속 학습일 → 이름 순, 둘 다 같으면 같은 순위 (1, 1, 3), 0 회도 끝에 나온다', async () => {
    const { db, user } = setup({ kana: false })
    const mio = await user('mio')
    const hana = await user('hana')
    const yuki = await user('yuki')
    const ken = await user('ken')
    const sora = await user('sora')
    log(db, hana.id, T0)
    log(db, hana.id, T0)
    log(db, yuki.id, T0)
    log(db, yuki.id, T0)
    log(db, ken.id, T0)
    log(db, ken.id, T0)
    // ken 은 어제(지난주 일요일)도 해서 연속 2일. 지난주 기록이라 이번 주 복습 수에는 안 들어간다
    log(db, ken.id, kst('2026-11-08T12:00:00'))
    log(db, sora.id, T0)
    const { entries } = await mio.get('/social/leaderboard')
    expect(brief(entries)).toEqual([
      [1, 'ken', 2, 2, false],
      [2, 'hana', 2, 1, false],
      [2, 'yuki', 2, 1, false],
      [4, 'sora', 1, 1, false],
      [5, 'mio', 0, 0, true],
    ])
  })

  it('주는 보는 사람 시간대의 월요일 04:00 에 시작한다', async () => {
    const { db, clock, user } = setup({ kana: false })
    const hana = await user('hana')
    log(db, hana.id, kst('2026-11-09T03:59:59')) // 일요일 학습일 → 지난주
    log(db, hana.id, kst('2026-11-09T04:00:00')) // 이번 주
    let lb = await hana.get('/social/leaderboard')
    expect(lb.start).toBe(kst('2026-11-09T04:00:00'))
    expect(lb.entries[0]).toMatchObject({ reviews: 1, streak: 2 })

    clock.now = kst('2026-11-16T03:59:00') // 아직 일요일 학습일
    lb = await hana.get('/social/leaderboard?period=week')
    expect(lb.start).toBe(kst('2026-11-09T04:00:00'))
    expect(lb.entries[0].reviews).toBe(1)

    clock.now = kst('2026-11-16T04:00:00')
    lb = await hana.get('/social/leaderboard')
    expect(lb.start).toBe(kst('2026-11-16T04:00:00'))
    expect(lb.entries[0].reviews).toBe(0)

    // 달: 1일 04:00
    clock.now = T0
    lb = await hana.get('/social/leaderboard?period=month')
    expect(lb).toMatchObject({ period: 'month', start: kst('2026-11-01T04:00:00') })
    expect(lb.entries[0].reviews).toBe(2)
    clock.now = kst('2026-12-01T03:00:00') // 아직 11-30 학습일
    expect((await hana.get('/social/leaderboard?period=month')).start).toBe(kst('2026-11-01T04:00:00'))

    // 보는 사람 시간대: T0 은 뉴욕 11-08(일) 20:00 → 그 주 월요일 11-02 04:00 EST
    clock.now = T0
    const ny = await user('nyc', { tz: 'America/New_York' })
    expect((await ny.get('/social/leaderboard')).start).toBe(Date.parse('2026-11-02T09:00:00Z'))

    expect((await hana.send('GET', '/social/leaderboard?period=year', undefined)).status).toBe(400)
  })
})

describe('친구 진도', () => {
  it('나와 공개를 끈 사용자는 빼고, 최근에 공부한 사람부터 (안 한 사람은 끝) 이름 순', async () => {
    const { db, clock, user } = setup()
    const me = await user('hana')
    const yuki = await user('yuki')
    const ken = await user('ken')
    const aoi = await user('aoi')
    await user('mio') // 기록 없음
    const hidden = await user('sora', { hidden: true })
    log(db, hidden.id, T0)

    clock.now = kst('2026-11-08T12:00:00')
    await ken.answer('kana-hira-a:kana-to-romaji', 'a')
    clock.now = T0
    for (const id of ['kana-hira-a:kana-to-romaji', 'kana-hira-i:kana-to-romaji']) await yuki.answer(id, right(db, id))
    await aoi.answer('kana-hira-a:kana-to-romaji', 'a')
    db.prepare(
      "UPDATE user_cards SET fsrs = json_set(fsrs, '$.state', 2, '$.scheduled_days', 30) WHERE user_id = ? AND card_id = 'kana-hira-i:kana-to-romaji'",
    ).run(yuki.id)
    clock.now = T0 + HOUR

    const { friends } = await me.get('/social/friends')
    expect(friends.map((f: { name: string }) => f.name)).toEqual(['aoi', 'yuki', 'ken', 'mio'])
    const y = friends[1]
    expect(y).toEqual({
      userId: yuki.id,
      name: 'yuki',
      level: 1,
      title: '「あ」부터 시작한 새싹 🌱',
      titleLang: 'ja',
      streak: 1,
      reviewsWeek: 2,
      lastStudiedDay: '2026-11-09',
      tracks: [
        { track: 'kana', learned: 2, mature: 1 },
        { track: 'kanji', learned: 0, mature: 0 },
        { track: 'toeic', learned: 0, mature: 0 },
        { track: 'toefl', learned: 0, mature: 0 },
      ],
    })
    // ken 은 지난주 일요일에 해서 이번 주 0 회, 연속 1일 (어제)
    expect(friends[2]).toMatchObject({ name: 'ken', reviewsWeek: 0, streak: 1, lastStudiedDay: '2026-11-08' })
    expect(friends[3]).toMatchObject({ name: 'mio', reviewsWeek: 0, streak: 0, lastStudiedDay: null })

    // 공개를 끈 사용자도 친구 목록은 볼 수 있다 (자기는 빠진다)
    const seen = (await hidden.get('/social/friends')).friends.map((f: { name: string }) => f.name)
    expect(seen).toEqual(['aoi', 'yuki', 'ken', 'hana', 'mio'])
  })
})
