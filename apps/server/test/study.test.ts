import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { KanaFields, Note } from '@nakamura/core'
import { createApp } from '../src/app.ts'
import { hashPassword } from '../src/auth/password.ts'
import { insertUser } from '../src/auth/users.ts'
import { ensureDataDirs, loadConfig } from '../src/config.ts'
import { importNotes, loadContentFiles, seedContentIfEmpty } from '../src/content.ts'
import { openDb } from '../src/db.ts'
import { publishedCatalog } from '../src/study/catalog.ts'
import { choicesFor, type QueueItem } from '../src/study/service.ts'

const KANA = join(import.meta.dirname, '../../../content/kana.json')
const HOUR = 3600 * 1000
/** 서울 벽시계 → ms */
const kst = (iso: string) => Date.parse(`${iso}+09:00`)
const T0 = kst('2026-11-09T10:00:00')

const setup = (opts: { kana?: boolean; extra?: Note[] } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'nakamura-study-'))
  const cfg = loadConfig({ DATA_DIR: join(dir, 'data'), WEB_DIST: join(dir, 'web') })
  ensureDataDirs(cfg)
  const db = openDb(cfg.dbPath)
  if (opts.kana !== false) importNotes(db, loadContentFiles([KANA]))
  if (opts.extra) importNotes(db, opts.extra.map(note => ({ note, source: 'test' })))
  const clock = { now: T0 }
  const app = createApp(cfg, db, { now: () => clock.now })

  const req = (method: string, path: string, body?: unknown, cookie?: string) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  const login = async (name = 'hana') => {
    insertUser(db, name, await hashPassword('password1'))
    const res = await req('POST', '/auth/login', { name, password: 'password1' })
    const cookie = res.headers
      .getSetCookie()
      .find(s => s.startsWith('nk_session='))!
      .split(';')[0]!
    const get = async (path: string) => (await req('GET', path, undefined, cookie)).json()
    const send = (method: string, path: string, body: unknown) => req(method, path, body, cookie)
    const queue = async (track = 'kana', limit = 100): Promise<QueueItem[]> =>
      (await get(`/study/queue?track=${track}&limit=${limit}`)).items
    const answer = (cardId: string, response: string, extra: Record<string, unknown> = {}) =>
      send('POST', '/study/answer', { cardId, response, ...extra })
    return { cookie, get, send, queue, answer }
  }

  return { cfg, db, clock, req, login }
}

/** 카드의 정답 (테스트용) */
const right = (db: DatabaseSync, cardId: string): string => {
  const [noteId, drillId] = cardId.split(':') as [string, string]
  const f = JSON.parse((db.prepare('SELECT fields FROM notes WHERE id = ?').get(noteId) as { fields: string }).fields)
  if (drillId === 'kana-to-romaji') return (f as KanaFields).romaji
  if (drillId === 'toeic-meaning') return f.meaning_ko
  return (f as KanaFields).char
}

const setDue = (db: DatabaseSync, cardId: string, due: number) =>
  db.prepare('UPDATE user_cards SET due = ? WHERE card_id = ?').run(due, cardId)

describe('로그인 필요', () => {
  it('학습 API 는 401', async () => {
    const { req } = setup({ kana: false })
    for (const [m, p] of [
      ['GET', '/study/summary'],
      ['GET', '/study/queue?track=kana'],
      ['POST', '/study/answer'],
      ['GET', '/study/settings'],
      ['PUT', '/study/settings'],
      ['POST', '/reports'],
      ['GET', '/notes?track=kana'],
    ] as const) {
      expect((await req(m, p, m === 'GET' ? undefined : {})).status, `${m} ${p}`).toBe(401)
    }
    // 인증이 필요 없는 기존 API 는 영향 없음
    expect((await req('GET', '/auth/me')).status).toBe(200)
  })
})

describe('큐', () => {
  it('처음: 히라가나를 50음도 순서로 먼저 (가타카나는 그 뒤), 새 노트는 글자 → 로마자로만 소개', async () => {
    const { login } = setup()
    const u = await login()
    const items = await u.queue('kana', 20)
    expect(items).toHaveLength(15) // 하루 새 카드 기본 15
    expect(items.slice(0, 6).map(i => i.cardId)).toEqual([
      'kana-hira-a:kana-to-romaji',
      'kana-hira-i:kana-to-romaji',
      'kana-hira-u:kana-to-romaji',
      'kana-hira-e:kana-to-romaji',
      'kana-hira-o:kana-to-romaji',
      'kana-hira-ka:kana-to-romaji',
    ])
    expect(items.every(i => i.isNew && i.drillId === 'kana-to-romaji')).toBe(true)
    expect(items[0]).toMatchObject({ noteId: 'kana-hira-a', track: 'kana', fields: { char: 'あ', romaji: 'a' } })
  })

  it('잘못된 트랙 · limit 은 400', async () => {
    const { login } = setup()
    const u = await login()
    expect((await u.get('/study/queue?track=nope')).error).toBeTruthy()
    for (const l of ['0', '101', '1.5', 'x']) expect((await u.get(`/study/queue?track=kana&limit=${l}`)).error, l).toBeTruthy()
  })

  it('복습할 카드(오래된 것부터)가 먼저, 그다음 새 카드. 같은 날에는 형제 카드를 내지 않는다', async () => {
    const { db, clock, login } = setup()
    const u = await login()
    for (const id of ['kana-hira-a:kana-to-romaji', 'kana-hira-i:kana-to-romaji', 'kana-hira-u:kana-to-romaji']) {
      expect((await u.answer(id, right(db, id))).status).toBe(200)
    }
    setDue(db, 'kana-hira-i:kana-to-romaji', T0 + 1000)
    setDue(db, 'kana-hira-a:kana-to-romaji', T0 + 2000)
    setDue(db, 'kana-hira-u:kana-to-romaji', T0 + 10 * HOUR) // 아직 아님
    clock.now = T0 + 5000

    const items = await u.queue()
    expect(items.slice(0, 2).map(i => [i.cardId, i.isNew])).toEqual([
      ['kana-hira-i:kana-to-romaji', false],
      ['kana-hira-a:kana-to-romaji', false],
    ])
    const fresh = items.slice(2)
    expect(fresh.length).toBe(12) // 15 - 오늘 소개한 3
    expect(fresh.every(i => i.isNew)).toBe(true)
    expect(fresh[0]!.cardId).toBe('kana-hira-e:kana-to-romaji')
    // 오늘 소개한 노트의 다른 연습 방식은 오늘 나오지 않는다
    expect(fresh.some(i => ['kana-hira-a', 'kana-hira-i', 'kana-hira-u'].includes(i.noteId))).toBe(false)
    expect(items.some(i => i.cardId === 'kana-hira-u:kana-to-romaji')).toBe(false)
  })

  it('다음 학습일: 후속 카드가 새 노트 1 : 후속 2 로 섞이고 같은 노트가 붙지 않는다', async () => {
    const { db, clock, login } = setup()
    const u = await login()
    for (const i of await u.queue('kana', 4)) await u.answer(i.cardId, right(db, i.cardId))
    db.prepare('UPDATE user_cards SET due = ?').run(T0 + 30 * 24 * HOUR) // 복습은 빼고 새 카드만 본다
    clock.now = kst('2026-11-10T09:00:00')

    const items = await u.queue('kana', 9)
    expect(items.every(i => i.isNew)).toBe(true)
    const kinds = items.map(i => (i.drillId === 'kana-to-romaji' && !['kana-hira-a', 'kana-hira-i', 'kana-hira-u', 'kana-hira-e'].includes(i.noteId) ? 'fresh' : 'follow'))
    expect(kinds).toEqual(['fresh', 'follow', 'follow', 'fresh', 'follow', 'follow', 'fresh', 'follow', 'follow'])
    for (let k = 1; k < items.length; k++) expect(items[k]!.noteId).not.toBe(items[k - 1]!.noteId)
    // 후속 카드는 어제 소개한 노트의 나머지 연습 방식
    const follow = items.filter((_, k) => kinds[k] === 'follow').map(i => i.cardId)
    expect(follow).toEqual([
      'kana-hira-a:romaji-to-kana',
      'kana-hira-i:romaji-to-kana',
      'kana-hira-u:romaji-to-kana',
      'kana-hira-e:romaji-to-kana',
      'kana-hira-a:kana-listen',
      'kana-hira-i:kana-listen',
    ])
  })

  it('할 카드가 없으면 20분 안에 돌아올 카드를 미리 낸다', async () => {
    const { db, login } = setup()
    const u = await login()
    await u.send('PUT', '/study/settings', { newPerDay: { kana: 1 } })
    expect((await u.answer('kana-hira-a:kana-to-romaji', 'x')).status).toBe(200) // 틀림 → 곧 다시
    const due = (db.prepare('SELECT due FROM user_cards').get() as { due: number }).due
    expect(due).toBeGreaterThan(T0)
    expect(due).toBeLessThanOrEqual(T0 + 20 * 60 * 1000)
    expect((await u.queue()).map(i => [i.cardId, i.isNew])).toEqual([['kana-hira-a:kana-to-romaji', false]])
  })

  it('고르기 보기: kana-listen 은 같은 문자 체계 4개, 소리가 같은 글자는 빼고, 가능하면 같은 묶음', () => {
    const { db } = setup()
    const cat = publishedCatalog(db, 'kana')
    for (const { note } of cat.notes) {
      const a = note.fields as KanaFields
      const choices = choicesFor(cat, note, 'kana-listen')!
      expect(choices, a.char).toHaveLength(4)
      expect(new Set(choices).size).toBe(4)
      expect(choices).toContain(a.char)
      const others = choices.filter(c => c !== a.char).map(c => cat.notes.find(n => (n.note.fields as KanaFields).char === c && (n.note.fields as KanaFields).script === a.script)!.note.fields as KanaFields)
      expect(others).toHaveLength(3)
      const sound = (f: KanaFields) => (f.romaji === 'wo' ? 'o' : f.romaji)
      for (const o of others) expect(sound(o), `${a.char} vs ${o.char}`).not.toBe(sound(a))
      const group = (f: KanaFields) => (f.yoon ? 'y' : f.dakuon ? 'd' : 'b')
      expect(others.every(o => group(o) === group(a)), a.char).toBe(true)
    }
    expect(choicesFor(cat, cat.notes[0]!.note, 'kana-to-romaji')).toBeUndefined()
  })

  it('고르기 보기: toeic-meaning 은 다른 단어의 뜻', async () => {
    const toeic = (word: string, meaning_ko: string): Note => ({ id: `toeic-${word}`, track: 'toeic', fields: { word, meaning_ko } })
    const { db, login } = setup({
      kana: false,
      extra: [toeic('invoice', '송장'), toeic('bill', '송장'), toeic('refund', '환불'), toeic('fee', '요금'), toeic('rent', '임대료')],
    })
    const u = await login()
    const items = await u.queue('toeic')
    const m = items.find(i => i.cardId === 'toeic-invoice:toeic-meaning')!
    expect(m.choices).toHaveLength(4)
    expect(new Set(m.choices).size).toBe(4)
    expect(m.choices).toContain('송장')
    expect(m.choices!.filter(c => c === '송장')).toHaveLength(1)
  })
})

describe('답', () => {
  it('하루 새 카드 수를 서버가 지킨다 (409)', async () => {
    const { db, login } = setup()
    const u = await login()
    await u.send('PUT', '/study/settings', { newPerDay: { kana: 2 } })
    const items = await u.queue()
    expect(items.map(i => i.cardId)).toEqual(['kana-hira-a:kana-to-romaji', 'kana-hira-i:kana-to-romaji'])
    for (const i of items) expect((await u.answer(i.cardId, right(db, i.cardId))).status).toBe(200)
    // 큐에 없는 새 카드를 직접 보내도 거절
    const over = await u.answer('kana-hira-u:kana-to-romaji', 'u')
    expect(over.status).toBe(409)
    expect(db.prepare("SELECT count(*) AS n FROM user_cards WHERE card_id = 'kana-hira-u:kana-to-romaji'").get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM review_logs').get()).toEqual({ n: 2 })
    // 이미 있는 카드 복습은 제한 없음
    expect((await u.answer('kana-hira-a:kana-to-romaji', 'a')).status).toBe(200)
    // 새 카드는 더 나오지 않는다 (곧 돌아올 학습 중 카드만 미리 나올 수 있다)
    expect((await u.queue()).filter(i => i.isNew)).toEqual([])
    expect((await u.get('/study/summary')).tracks[0]).toMatchObject({ newLeft: 0, learned: 2 })
  })

  it('틀리면 클라이언트가 4 를 보내도 다시(Again)', async () => {
    const { db, login } = setup()
    const u = await login()
    const res = await u.answer('kana-hira-ka:kana-to-romaji', 'ga', { rating: 4 })
    expect(await res.json()).toMatchObject({ correct: false, expected: 'ka', rating: 1 })
    expect(db.prepare('SELECT rating, correct, response FROM review_logs').get()).toEqual({ rating: 1, correct: 0, response: 'ga' })
  })

  it('서버가 다시 채점한다: 클라이언트의 correct 는 무시', async () => {
    const { login } = setup()
    const u = await login()
    const fake = await (await u.answer('kana-hira-shi:kana-to-romaji', 'xx', { correct: true, rating: 3 })).json()
    expect(fake).toMatchObject({ correct: false, rating: 1, expected: 'shi' })
    // 훈령식도 정답 (core check)
    const ok = await (await u.answer('kana-hira-chi:kana-to-romaji', 'ti')).json()
    expect(ok).toMatchObject({ correct: true, rating: 3 })
    const hard = await (await u.answer('kana-hira-a:kana-to-romaji', 'A', { rating: 2 })).json()
    expect(hard).toMatchObject({ correct: true, rating: 2 })
  })

  it('맞히면(좋음) 다음 복습이 점점 뒤로 간다', async () => {
    const { db, clock, login } = setup()
    const u = await login()
    const id = 'kana-hira-a:kana-to-romaji'
    const first = await (await u.answer(id, 'a')).json()
    expect(first.due).toBeGreaterThan(clock.now)
    let prevGap = first.due - clock.now
    for (let k = 0; k < 4; k++) {
      clock.now = (db.prepare('SELECT due FROM user_cards WHERE card_id = ?').get(id) as { due: number }).due
      const r = await (await u.answer(id, 'a')).json()
      expect(r.rating).toBe(3)
      const gap = r.due - clock.now
      expect(gap).toBeGreaterThan(prevGap)
      prevGap = gap
    }
    const row = db.prepare('SELECT fsrs, due FROM user_cards WHERE card_id = ?').get(id) as { fsrs: string; due: number }
    expect(new Date(JSON.parse(row.fsrs).due).getTime()).toBe(row.due)
    expect(db.prepare('SELECT count(*) AS n FROM review_logs').get()).toEqual({ n: 5 })
  })

  it('없는 · 비공개 · 맞지 않는 카드는 404, 비공개 노트의 카드는 큐에서 빠진다', async () => {
    const { db, clock, login } = setup()
    const u = await login()
    expect((await u.answer('kana-hira-a:kana-to-romaji', 'a')).status).toBe(200)
    db.prepare("UPDATE notes SET status = 'draft' WHERE id = 'kana-hira-a'").run()
    clock.now = T0 + 365 * 24 * HOUR
    expect((await u.answer('kana-hira-a:kana-to-romaji', 'a')).status).toBe(404)
    expect((await u.queue()).some(i => i.noteId === 'kana-hira-a')).toBe(false)
    expect((await u.get('/study/summary')).tracks[0]).toMatchObject({ due: 0, learned: 1 })
    for (const id of ['nope', ':kana-to-romaji', 'kana-hira-i:', 'kana-hira-i:toeic-cloze', 'kana-hira-i:no-such', 'kana-x:kana-to-romaji']) {
      expect((await u.answer(id, 'i')).status, id).toBe(404)
    }
    expect((await u.send('POST', '/study/answer', { cardId: 'kana-hira-i:kana-to-romaji' })).status).toBe(400)
    expect((await u.answer('kana-hira-i:kana-to-romaji', 'i', { rating: 1 })).status).toBe(400)
    expect((await u.answer('kana-hira-i:kana-to-romaji', 'x'.repeat(201))).status).toBe(400)
  })

  it('romaji-to-kana 는 문자 체계까지 맞아야 정답', async () => {
    const { login } = setup()
    const u = await login()
    expect(await (await u.answer('kana-hira-ka:romaji-to-kana', 'カ')).json()).toMatchObject({ correct: false, expected: 'か' })
    expect(await (await u.answer('kana-kata-ka:romaji-to-kana', 'カ')).json()).toMatchObject({ correct: true })
  })
})

describe('하루 경계 · 연속 학습일 · 요약', () => {
  it('03:59 까지는 전날, 04:00 에 새 카드 수 · 오늘 복습 수가 새로 시작된다', async () => {
    const { db, clock, login } = setup()
    const u = await login()
    await u.send('PUT', '/study/settings', { newPerDay: { kana: 1 } })

    clock.now = kst('2026-11-08T12:00:00')
    expect((await u.answer('kana-hira-a:kana-to-romaji', 'a')).status).toBe(200)

    clock.now = kst('2026-11-10T03:59:00') // 학습일 11-09
    expect((await u.answer('kana-kata-a:kana-to-romaji', 'a')).status).toBe(200)
    expect((await u.answer('kana-hira-i:kana-to-romaji', 'i')).status).toBe(409)
    let s = await u.get('/study/summary')
    expect(s).toMatchObject({ day: '2026-11-09', streak: 2, reviewsToday: 1 })
    expect(s.tracks[0]).toMatchObject({ track: 'kana', newLeft: 0, reviewsToday: 1 })

    clock.now = kst('2026-11-10T04:00:00') // 학습일 11-10: 아직 안 했지만 어제까지 이어진 2일
    s = await u.get('/study/summary')
    expect(s).toMatchObject({ day: '2026-11-10', streak: 2, reviewsToday: 0 })
    expect(s.tracks[0]).toMatchObject({ newLeft: 1, reviewsToday: 0 })
    expect((await u.answer('kana-hira-i:kana-to-romaji', 'i')).status).toBe(200)
    expect((await u.get('/study/summary')).streak).toBe(3)

    clock.now = kst('2026-11-11T23:00:00') // 학습일 11-11 아직 안 함 → 어제(11-10)까지 3일
    expect((await u.get('/study/summary')).streak).toBe(3)
    clock.now = kst('2026-11-12T04:00:00') // 11-11 을 건너뜀
    expect((await u.get('/study/summary')).streak).toBe(0)
    void db
  })

  it('사용자 시간대를 따른다', async () => {
    const { db, clock, login } = setup()
    const u = await login()
    db.prepare("UPDATE users SET tz = 'America/New_York'").run()
    clock.now = Date.parse('2026-11-09T08:30:00Z') // 뉴욕 03:30 → 학습일 11-08
    expect((await u.get('/study/summary')).day).toBe('2026-11-08')
    clock.now = Date.parse('2026-11-09T09:00:00Z') // 뉴욕 04:00 (EST)
    expect((await u.get('/study/summary')).day).toBe('2026-11-09')
  })

  it('요약 숫자', async () => {
    const { db, clock, login } = setup()
    const u = await login()
    await u.send('PUT', '/study/settings', { newPerDay: { kana: 5 } })
    const ids = ['kana-hira-a', 'kana-kata-a', 'kana-hira-i'].map(n => `${n}:kana-to-romaji`)
    await u.answer(ids[0]!, 'a')
    await u.answer(ids[1]!, 'wrong')
    await u.answer(ids[2]!, 'i')
    await u.answer(ids[0]!, 'a') // 같은 카드 한 번 더
    setDue(db, ids[0]!, T0 - 1)
    setDue(db, ids[1]!, T0)
    setDue(db, ids[2]!, T0 + HOUR)

    const s = await u.get('/study/summary')
    expect(s).toMatchObject({ day: '2026-11-09', streak: 1, reviewsToday: 4 })
    expect(s.tracks).toEqual([
      { track: 'kana', notes: 208, due: 2, newLeft: 2, newPerDay: 5, learned: 3, reviewsToday: 4 },
      { track: 'kanji', notes: 0, due: 0, newLeft: 0, newPerDay: 15, learned: 0, reviewsToday: 0 },
      { track: 'toeic', notes: 0, due: 0, newLeft: 0, newPerDay: 15, learned: 0, reviewsToday: 0 },
    ])
    // 다른 사용자는 따로
    const v = await login('dul')
    expect((await v.get('/study/summary')).tracks[0]).toMatchObject({ due: 0, newLeft: 15, learned: 0, reviewsToday: 0 })
    void clock
  })
})

describe('설정', () => {
  it('기본 15, 바꾸기, 검사', async () => {
    const { login } = setup()
    const u = await login()
    expect(await u.get('/study/settings')).toEqual({ newPerDay: { kana: 15, kanji: 15, toeic: 15 } })
    const ok = await u.send('PUT', '/study/settings', { newPerDay: { kana: 30, toeic: 0 } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ newPerDay: { kana: 30, kanji: 15, toeic: 0 } })
    expect(await u.get('/study/settings')).toEqual({ newPerDay: { kana: 30, kanji: 15, toeic: 0 } })
    expect((await u.send('PUT', '/study/settings', { newPerDay: { kana: 100 } })).status).toBe(200)
    for (const bad of [
      {},
      { newPerDay: 5 },
      { newPerDay: [] },
      { newPerDay: { kana: -1 } },
      { newPerDay: { kana: 101 } },
      { newPerDay: { kana: 1.5 } },
      { newPerDay: { kana: '3' } },
      { newPerDay: { toefl: 3 } },
      { newPerDay: { kana: 3, kanji: null } },
    ]) {
      expect((await u.send('PUT', '/study/settings', bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect((await u.get('/study/settings')).newPerDay.kana).toBe(100)
  })
})

describe('신고', () => {
  it('만들기 · 검사', async () => {
    const { db, login } = setup()
    const u = await login()
    const res = await u.send('POST', '/reports', {
      noteId: 'kana-hira-a',
      cardId: 'kana-hira-a:kana-listen',
      reason: 'audio',
      body: '  소리가 안 나요  ',
    })
    expect(res.status).toBe(201)
    const { id } = await res.json()
    expect(db.prepare('SELECT note_id, card_id, reason, body, status FROM reports WHERE id = ?').get(id)).toEqual({
      note_id: 'kana-hira-a',
      card_id: 'kana-hira-a:kana-listen',
      reason: 'audio',
      body: '소리가 안 나요',
      status: 'open',
    })
    expect((await u.send('POST', '/reports', { noteId: 'kana-hira-i', reason: 'typo' })).status).toBe(201)
    for (const bad of [
      { reason: 'typo' },
      { noteId: 'kana-hira-a', reason: 'boring' },
      { noteId: 'kana-hira-a', reason: 'other', body: 'x'.repeat(1001) },
      { noteId: 'kana-hira-a', cardId: 'kana-hira-i:kana-listen', reason: 'other' },
    ]) {
      expect((await u.send('POST', '/reports', bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect((await u.send('POST', '/reports', { noteId: 'kana-none', reason: 'other' })).status).toBe(404)
    expect((await u.send('POST', '/reports', { noteId: 'kana-hira-a', reason: 'other', body: 'x'.repeat(1000) })).status).toBe(201)
  })
})

describe('공개 노트 조회', () => {
  it('가나 208자, 비공개는 빠진다', async () => {
    const { db, login } = setup()
    const u = await login()
    db.prepare("UPDATE notes SET status = 'retired' WHERE id = 'kana-kata-n'").run()
    const { notes } = await u.get('/notes?track=kana')
    expect(notes).toHaveLength(207)
    expect(notes[0]).toEqual({ id: 'kana-hira-a', fields: expect.objectContaining({ char: 'あ', order: 0 }) })
    expect((await u.get('/notes?track=nope')).error).toBeTruthy()
  })
})

describe('시작 시 콘텐츠 넣기', () => {
  it('notes 가 비어 있을 때만 넣는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nakamura-seed-'))
    const content = join(dir, 'content')
    mkdirSync(content)
    copyFileSync(KANA, join(content, 'kana.json'))
    const { db } = setup({ kana: false })

    expect(seedContentIfEmpty(db, join(dir, 'missing'))).toBeNull()
    expect(seedContentIfEmpty(db, dir)).toBeNull() // *.json 없음
    const r = seedContentIfEmpty(db, content)
    expect(r).toMatchObject({ added: 208, updated: 0, unchanged: 0 })
    expect(db.prepare("SELECT count(*) AS n FROM notes WHERE status = 'published'").get()).toEqual({ n: 208 })

    // 이미 노트가 있으면 (지운 노트가 있어도) 다시 넣지 않는다
    db.prepare("DELETE FROM notes WHERE id = 'kana-hira-a'").run()
    expect(seedContentIfEmpty(db, content)).toBeNull()
    expect(db.prepare('SELECT count(*) AS n FROM notes').get()).toEqual({ n: 207 })
  })
})

describe('한자 새 카드 순서', () => {
  it('JLPT 쉬운 레벨 먼저, 같은 레벨은 자주 쓰는 순', async () => {
    const { publishedCatalog } = await import('../src/study/catalog.ts')
    const { DatabaseSync } = await import('node:sqlite')
    const { migrate } = await import('../src/db.ts')
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const add = (k: string, jlpt: number, freq?: number) =>
      db
        .prepare("INSERT INTO notes(id, track, fields, status, source, created_at, updated_at) VALUES (?, 'kanji', ?, 'published', 't', 0, 0)")
        .run(`kanji-${k}`, JSON.stringify({ kanji: k, on: [], kun: [], meanings_ko: ['뜻'], jlpt, ...(freq ? { freq } : {}) }))
    add('議', 3, 50)
    add('一', 5, 2)
    add('日', 5, 1)
    add('楽', 4, 373)
    add('枠', 1)
    expect(publishedCatalog(db, 'kanji').notes.map(n => n.note.id)).toEqual(['kanji-日', 'kanji-一', 'kanji-楽', 'kanji-議', 'kanji-枠'])
  })
})
