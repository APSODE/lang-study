import { describe, expect, it } from 'vitest'
import { DAY, HOUR, log, right, setup, T0 } from './helpers.ts'

describe('레벨 (활동 XP)', () => {
  it('카드별 첫 답 +3, 그 뒤 정답 +2 · 오답 +1, 오늘 얻은 XP 따로', async () => {
    const { db, user } = setup({ kana: false })
    const hana = await user('hana')
    log(db, hana.id, T0 - DAY, true, 'a:x') // 어제: 첫 답 3
    log(db, hana.id, T0 - HOUR, true, 'a:x') // 오늘: 정답 2
    log(db, hana.id, T0 - HOUR, false, 'a:x') // 오답 1
    log(db, hana.id, T0, false, 'b:x') // 첫 답 3 (틀려도)
    const s = await hana.get('/study/summary')
    expect(s.level).toMatchObject({ xp: 9, xpToday: 6, level: 1, levelXp: 0, nextLevelXp: 50 })
    expect(s.level.title).toBe('「あ」부터 시작한 새싹 🌱')
  })

  it('연속 학습일 7일째 +20', async () => {
    const { db, user } = setup({ kana: false })
    const hana = await user('hana')
    for (let k = 6; k >= 0; k--) log(db, hana.id, T0 - k * DAY, true, 'a:x')
    const s = await hana.get('/study/summary')
    // 첫 답 3 + 정답 6 × 2 + 7일 보너스 20
    expect(s.level).toMatchObject({ xp: 35, xpToday: 22 })
  })

  it('공개된 내가 만든 문제 개당 +5 (초안은 안 친다)', async () => {
    const { db, user } = setup({ kana: false })
    const hana = await user('hana')
    const ins = db.prepare(
      "INSERT INTO notes(id, track, fields, status, source, created_at, updated_at) VALUES (?, 'deck', '{}', ?, ?, ?, ?)",
    )
    ins.run('deck-x-1', 'published', `upload:${hana.id}`, T0 - DAY, T0 - DAY)
    ins.run('deck-x-2', 'published', `upload:${hana.id}`, T0, T0)
    ins.run('deck-x-3', 'draft', `upload:${hana.id}`, T0, T0)
    const s = await hana.get('/study/summary')
    expect(s.level).toMatchObject({ xp: 10, xpToday: 5 })
  })

  it('레벨 · 칭호가 친구 목록 · 순위에 나온다 (공개를 끈 사람은 안 나온다)', async () => {
    const { db, user } = setup({ kana: false })
    const hana = await user('hana')
    const yuki = await user('yuki')
    await user('ken', { hidden: true })
    for (let k = 0; k < 17; k++) log(db, yuki.id, T0, true, `c${k}:x`) // 51 XP → Lv2
    const { friends } = await hana.get('/social/friends')
    expect(friends.map((f: any) => [f.name, f.level, f.title])).toEqual([['yuki', 2, '「あ」부터 시작한 새싹 🌱']])
    const { entries } = await hana.get('/social/leaderboard')
    expect(entries.map((e: any) => [e.name, e.level])).toEqual([
      ['yuki', 2],
      ['hana', 1],
    ])
  })
})

describe('칭호 언어 (일본어 · 영어)', () => {
  /** 영어 단어 노트 (토익) — 복습 기록이 영어 XP 로 잡히도록 */
  const toeic = (db: any, id: string) =>
    db
      .prepare("INSERT INTO notes(id, track, fields, status, source, created_at, updated_at) VALUES (?, 'toeic', '{}', 'published', 'test', ?, ?)")
      .run(id, T0 - DAY, T0 - DAY)

  it('자동: 복습 XP 가 더 많은 언어, 같으면 일본어 (항목 · 보너스는 판정에서 뺀다)', async () => {
    const { db, user } = setup()
    const hana = await user('hana')
    toeic(db, 'toeic-a')
    toeic(db, 'toeic-b')
    log(db, hana.id, T0, true, 'kana-hira-a:kana-to-romaji') // 일본어 3
    log(db, hana.id, T0, true, 'toeic-a:toeic-meaning') // 영어 3 → 같음 → 일본어
    // 항목 노트 기록과 공개한 내 문제(+5)는 언어 판정에 안 들어간다
    db.prepare("INSERT INTO notes(id, track, fields, status, source, created_at, updated_at) VALUES ('deck-x-1', 'deck', '{}', 'published', ?, ?, ?)").run(
      `upload:${hana.id}`,
      T0,
      T0,
    )
    log(db, hana.id, T0, true, 'deck-x-1:deck-meaning')
    let s = await hana.get('/study/summary')
    expect(s.level).toMatchObject({ titleLang: 'ja', title: '「あ」부터 시작한 새싹 🌱', xp: 14 })
    log(db, hana.id, T0, true, 'toeic-b:toeic-meaning') // 영어 6 > 일본어 3
    s = await hana.get('/study/summary')
    expect(s.level).toMatchObject({ titleLang: 'en', title: 'ABC 떼고 온 새싹 🌱', xp: 17 })
  })

  it('설정한 언어가 저장되고, 친구 · 순위에는 그 사람이 고른 칭호가 나온다', async () => {
    const { db, user } = setup()
    const hana = await user('hana')
    const yuki = await user('yuki')
    log(db, yuki.id, T0, true, 'kana-hira-a:kana-to-romaji') // 자동이면 일본어
    let res = await yuki.send('PUT', '/me/profile', { titleLang: 'en' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ titleLang: 'en' })
    expect(await yuki.get('/me/profile')).toMatchObject({ titleLang: 'en' })
    expect((await yuki.get('/study/summary')).level).toMatchObject({ titleLang: 'en', title: 'ABC 떼고 온 새싹 🌱' })

    const { friends } = await hana.get('/social/friends')
    expect(friends.map((f: any) => [f.name, f.titleLang, f.title])).toEqual([['yuki', 'en', 'ABC 떼고 온 새싹 🌱']])
    const { entries } = await hana.get('/social/leaderboard')
    expect(entries.map((e: any) => [e.name, e.titleLang, e.title])).toEqual([
      ['yuki', 'en', 'ABC 떼고 온 새싹 🌱'],
      ['hana', 'ja', '「あ」부터 시작한 새싹 🌱'],
    ])

    // 자동으로 되돌리기 · 잘못된 값
    expect((await yuki.send('PUT', '/me/profile', { titleLang: 'kr' })).status).toBe(400)
    expect((await yuki.send('PUT', '/me/profile', { titleLang: null })).status).toBe(400)
    res = await yuki.send('PUT', '/me/profile', { titleLang: 'auto' })
    expect(await res.json()).toMatchObject({ titleLang: 'auto' })
    expect((await yuki.get('/study/summary')).level).toMatchObject({ titleLang: 'ja' })
  })
})

describe('트랙별 실력', () => {
  it('간격 21일 이상 카드가 있는 노트를 익힌 것으로 센다', async () => {
    const { db, user } = setup()
    const hana = await user('hana')
    const { items } = await hana.get('/study/queue?track=kana&limit=1')
    const id = items[0].cardId as string
    await hana.answer(id, right(db, id))
    let s = await hana.get('/study/summary')
    const kana = () => s.tracks.find((t: any) => t.track === 'kana').mastery
    expect(kana().mastered).toBe(0)
    expect(kana().total).toBeGreaterThan(100)
    expect(kana().jlpt).toBeNull()
    db.prepare("UPDATE user_cards SET fsrs = json_set(fsrs, '$.state', 2, '$.scheduled_days', 30) WHERE user_id = ?").run(hana.id)
    s = await hana.get('/study/summary')
    expect(kana().mastered).toBe(1)
  })
})

describe('한자 실력', () => {
  it('쉬운 단계부터 80% 이상 익힌 가장 높은 JLPT 단계', async () => {
    const k = (ch: string, jlpt: number) => ({
      id: `kanji-${ch}`,
      track: 'kanji' as const,
      fields: { kanji: ch, on: ['イチ'], kun: [], meanings_ko: ['하나'], jlpt },
    })
    const notes = [...'一二三四五'].map(c => k(c, 5)).concat([...'六七'].map(c => k(c, 4)))
    const { db, user } = setup({ kana: false, extra: notes })
    const hana = await user('hana')
    const master = (ch: string) =>
      db
        .prepare(
          `INSERT INTO user_cards(user_id, card_id, note_id, drill_id, track, fsrs, due, introduced_at)
           VALUES (?, ?, ?, 'x', 'kanji', '{"state":2,"scheduled_days":40}', 0, 0)`,
        )
        .run(hana.id, `kanji-${ch}:x`, `kanji-${ch}`)
    const m = async () => (await hana.get('/study/summary')).tracks.find((t: any) => t.track === 'kanji').mastery
    for (const c of '一二三') master(c)
    expect(await m()).toEqual({ mastered: 3, total: 7, jlpt: null })
    master('四') // N5 4/5 = 80%
    expect(await m()).toEqual({ mastered: 4, total: 7, jlpt: 5 })
    master('六')
    master('七') // N4 2/2 도 채웠다
    expect(await m()).toEqual({ mastered: 6, total: 7, jlpt: 4 })
  })
})
