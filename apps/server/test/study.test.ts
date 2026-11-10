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
  if (drillId === 'toeic-cloze' || drillId === 'word-spell') return f.word
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

  it('토플: 토익 연습 방식을 같은 id 로 쓰고, 보기는 토플 단어에서만', async () => {
    const toeic = (word: string, meaning_ko: string): Note => ({ id: `toeic-${word}`, track: 'toeic', fields: { word, meaning_ko } })
    const toefl = (word: string, meaning_ko: string, example_en?: string): Note => ({
      id: `toefl-${word}`,
      track: 'toefl',
      fields: { word, meaning_ko, list: 'NAWL', ...(example_en ? { example_en } : {}) },
    })
    const { db, login } = setup({
      kana: false,
      extra: [
        toeic('invoice', '송장'),
        toeic('refund', '환불'),
        toeic('fee', '요금'),
        toefl('hypothesis', '가설', 'The data support the hypothesis.'),
        toefl('erosion', '침식'),
        toefl('enzyme', '효소'),
        toefl('thesis', '논문'),
      ],
    })
    const u = await login()
    const items = await u.queue('toefl')
    expect(items.every(i => i.track === 'toefl')).toBe(true)
    const m = items.find(i => i.cardId === 'toefl-hypothesis:toeic-meaning')!
    expect(m.choices).toHaveLength(4)
    expect([...m.choices!].sort()).toEqual(['가설', '논문', '침식', '효소'].sort())
    // 예문이 있으면 빈칸 카드도 생긴다 (새 노트는 첫 연습 방식부터 소개하므로 카탈로그로 확인)
    expect(publishedCatalog(db, 'toefl').byId.get('toefl-hypothesis')!.drills.map(d => d.id)).toEqual(['toeic-meaning', 'toeic-cloze', 'word-spell'])
    // 토익 큐에는 토플 단어가 없다
    expect((await u.queue('toeic')).every(i => i.noteId.startsWith('toeic-'))).toBe(true)

    const res = await u.answer(m.cardId, right(db, m.cardId))
    expect(res.status).toBe(200)
    expect((await res.json()).correct).toBe(true)
    const s = await u.get('/study/summary')
    expect(s.tracks.find((t: { track: string }) => t.track === 'toefl')).toMatchObject({ notes: 4, learned: 1 })
    expect(s.tracks.find((t: { track: string }) => t.track === 'toeic')).toMatchObject({ notes: 3, learned: 0 })
  })
})

describe('철자 채우기 (word-spell)', () => {
  const word = (track: 'toeic' | 'toefl', w: string, meaning_ko: string, example_en?: string): Note => ({
    id: `${track}-${w}`,
    track,
    fields: { word: w, meaning_ko, ...(track === 'toefl' ? { list: 'NAWL' } : {}), ...(example_en ? { example_en } : {}) },
  })

  it('토익 · 토플 단어 모두에 붙고, 뜻 카드를 본 다음 날 뜻 · 빈칸 뒤에 후속 카드로 나온다', async () => {
    const { db, clock, login } = setup({
      kana: false,
      extra: [
        word('toeic', 'invoice', '송장', 'Please send the invoice.'),
        word('toeic', 'refund', '환불'),
        word('toefl', 'erosion', '침식'),
      ],
    })
    expect(publishedCatalog(db, 'toeic').byId.get('toeic-refund')!.drills.map(d => d.id)).toEqual(['toeic-meaning', 'word-spell'])
    expect(publishedCatalog(db, 'toefl').byId.get('toefl-erosion')!.drills.map(d => d.id)).toEqual(['toeic-meaning', 'word-spell'])
    const u = await login()

    // 첫날: 새 노트는 뜻 카드로만 소개
    const day1 = await u.queue('toeic')
    expect(day1.map(i => i.cardId).sort()).toEqual(['toeic-invoice:toeic-meaning', 'toeic-refund:toeic-meaning'])
    for (const i of day1) expect((await u.answer(i.cardId, right(db, i.cardId))).status).toBe(200)
    db.prepare('UPDATE user_cards SET due = ?').run(T0 + 30 * 24 * HOUR)
    clock.now = kst('2026-11-10T09:00:00')

    // 다음 날: 후속 카드는 연습 방식 순서(빈칸 → 철자)
    const day2 = (await u.queue('toeic')).map(i => i.cardId)
    expect(day2).toEqual(['toeic-invoice:toeic-cloze', 'toeic-refund:word-spell', 'toeic-invoice:word-spell'])

    let res = await u.answer('toeic-refund:word-spell', 'Refund ')
    expect(await res.json()).toMatchObject({ correct: true, expected: 'refund' })
    res = await u.answer('toeic-invoice:word-spell', 'invoic')
    expect(await res.json()).toMatchObject({ correct: false, expected: 'invoice', rating: 1 })

    // 토플도 같은 방식
    for (const i of await u.queue('toefl')) await u.answer(i.cardId, right(db, i.cardId))
    db.prepare("UPDATE user_cards SET due = ? WHERE track = 'toefl'").run(T0 + 60 * 24 * HOUR)
    clock.now = kst('2026-11-11T09:00:00')
    const toefl = await u.queue('toefl')
    expect(toefl.map(i => i.cardId)).toEqual(['toefl-erosion:word-spell'])
    res = await u.answer('toefl-erosion:word-spell', 'erosion')
    expect((await res.json()).correct).toBe(true)
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
      { track: 'toefl', notes: 0, due: 0, newLeft: 0, newPerDay: 15, learned: 0, reviewsToday: 0 },
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
    expect(await u.get('/study/settings')).toEqual({ newPerDay: { kana: 15, kanji: 15, toeic: 15, toefl: 15 }, writeNewPerDay: 10 })
    const ok = await u.send('PUT', '/study/settings', { newPerDay: { kana: 30, toeic: 0 } })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ newPerDay: { kana: 30, kanji: 15, toeic: 0, toefl: 15 }, writeNewPerDay: 10 })
    expect(await u.get('/study/settings')).toEqual({ newPerDay: { kana: 30, kanji: 15, toeic: 0, toefl: 15 }, writeNewPerDay: 10 })
    expect((await u.send('PUT', '/study/settings', { newPerDay: { kana: 100 } })).status).toBe(200)
    for (const bad of [
      {},
      { newPerDay: 5 },
      { newPerDay: [] },
      { newPerDay: { kana: -1 } },
      { newPerDay: { kana: 101 } },
      { newPerDay: { kana: 1.5 } },
      { newPerDay: { kana: '3' } },
      { newPerDay: { ielts: 3 } },
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

describe('일작 (kanji-write, 자기 평가)', () => {
  const EAT: Note = {
    id: 'kanji-食',
    track: 'kanji',
    fields: {
      kanji: '食',
      on: ['ショク'],
      kun: ['た.べる'],
      meanings_ko: ['먹다'],
      jlpt: 5,
      hunum_ko: '먹을 식',
      sentences: [{ ja: '友だちとすしを食べます。', kana: 'ともだちとすしをたべます。', ko: '친구와 초밥을 먹습니다.' }],
    },
  }
  const WRITE = 'kanji-食:kanji-write'
  const READ = 'kanji-食:kanji-reading'

  it('큐는 한자를 여전히 kanji-reading 으로 처음 소개한다', async () => {
    const { login } = setup({ kana: false, extra: [EAT] })
    const u = await login()
    expect((await u.queue('kanji')).map(i => i.cardId)).toEqual([READ])
  })

  it('자동 채점: 한자 표기 · 가나 전체 모두 정답', async () => {
    const { login } = setup({ kana: false, extra: [EAT] })
    const u = await login()
    const r = await (await u.answer(WRITE, 'ともだちとすしをたべます', { rating: 4 })).json()
    expect(r).toMatchObject({ correct: true, expected: '友だちとすしを食べます。', rating: 4 })
  })

  it('틀린 답 + selfCorrect: true 는 맞힌 것으로 (평가는 보낸 값, 기본 좋음)', async () => {
    const { db, login } = setup({ kana: false, extra: [EAT] })
    const u = await login()
    const r = await (await u.answer(WRITE, '友達とすしを食べます', { selfCorrect: true, rating: 2 })).json()
    expect(r).toMatchObject({ correct: true, rating: 2, expected: '友だちとすしを食べます。' })
    expect(db.prepare('SELECT rating, correct, response FROM review_logs').get()).toEqual({
      rating: 2,
      correct: 1,
      response: '友達とすしを食べます',
    })
    db.prepare('DELETE FROM user_cards').run()
    const d = await (await u.answer(WRITE, '友達とすしを食べます', { selfCorrect: true })).json()
    expect(d).toMatchObject({ correct: true, rating: 3 })
  })

  it('selfCorrect: false 이거나 없으면 다시(Again)', async () => {
    const { login } = setup({ kana: false, extra: [EAT] })
    const u = await login()
    expect(await (await u.answer(WRITE, '友達', { selfCorrect: false, rating: 4 })).json()).toMatchObject({ correct: false, rating: 1 })
    expect(await (await u.answer(WRITE, '友達', { rating: 4 })).json()).toMatchObject({ correct: false, rating: 1 })
  })

  it('자기 평가가 아닌 연습 방식은 selfCorrect 를 무시한다 (kanji-reading · kana)', async () => {
    const { db, login } = setup({ extra: [EAT] })
    const u = await login()
    const r = await (await u.answer(READ, 'のむ', { selfCorrect: true, rating: 4 })).json()
    expect(r).toMatchObject({ correct: false, rating: 1 })
    const k = await (await u.answer('kana-hira-ka:kana-to-romaji', 'ga', { selfCorrect: true, rating: 3 })).json()
    expect(k).toMatchObject({ correct: false, rating: 1 })
    expect(db.prepare('SELECT count(*) AS n FROM review_logs WHERE correct = 1').get()).toEqual({ n: 0 })
  })

  it('selfCorrect 형식이 틀리면 400', async () => {
    const { login } = setup({ kana: false, extra: [EAT] })
    const u = await login()
    expect((await u.answer(WRITE, 'x', { selfCorrect: 'yes' })).status).toBe(400)
    expect((await u.answer(WRITE, 'x', { selfCorrect: 1 })).status).toBe(400)
  })
})

describe('작문 모드 (mode=write)', () => {
  const kj = (k: string, jlpt: number, freq: number, sentence = true): Note => ({
    id: `kanji-${k}`,
    track: 'kanji',
    fields: {
      kanji: k,
      on: ['オン'],
      kun: [],
      meanings_ko: ['뜻'],
      jlpt,
      freq,
      ...(sentence ? { sentences: [{ ja: `${k}です。`, kana: 'です。', ko: `${k} 입니다.` }] } : {}),
    },
  })
  // 카탈로그 순서: 日(N5) 一(N5) 楽(N4) 議(N3) 枠(N1, 예문 없음)
  const NOTES = [kj('一', 5, 2), kj('日', 5, 1), kj('楽', 4, 373), kj('議', 3, 50), kj('枠', 1, 900, false)]
  const W = (k: string) => `kanji-${k}:kanji-write`
  const R = (k: string) => `kanji-${k}:kanji-reading`

  const start = async () => {
    const t = setup({ kana: false, extra: NOTES })
    const u = await t.login()
    const wq = async (q = '') => (await u.get(`/study/queue?track=kanji&mode=write&limit=100${q}`)).items as QueueItem[]
    return { ...t, u, wq }
  }

  it('보통 한자 큐 · 요약에는 작문 카드가 없다 (다음 날 후속 카드에도)', async () => {
    const { db, clock, u } = await start()
    expect((await u.queue('kanji')).map(i => i.cardId)).toEqual([R('日'), R('一'), R('楽'), R('議'), R('枠')])
    for (const k of ['日', '一']) expect((await u.answer(R(k), 'オン')).status).toBe(200)
    db.prepare('UPDATE user_cards SET due = ?').run(T0 + 30 * 24 * HOUR)
    clock.now = kst('2026-11-10T09:00:00')
    const items = await u.queue('kanji')
    expect(items.some(i => i.drillId === 'kanji-write')).toBe(false)
    expect(items.filter(i => i.noteId === 'kanji-日').map(i => i.drillId)).toEqual(['kanji-meaning'])
    const kanji = (await u.get('/study/summary')).tracks[1]
    expect(kanji).toMatchObject({ track: 'kanji', newLeft: 5, learned: 2, due: 0 }) // 새 노트 3 + 후속 2 (작문 빼고)
  })

  it('작문 카드만 한 노트도 보통 모드에서는 처음 보는 노트 (reading 으로 소개)', async () => {
    const { u } = await start()
    expect((await u.answer(W('日'), '日です')).status).toBe(200)
    expect((await u.queue('kanji'))[0]!.cardId).toBe(R('日'))
    const s = await u.get('/study/summary')
    expect(s.tracks[1]).toMatchObject({ learned: 0, due: 0, newLeft: 5 })
    expect(s.writing).toMatchObject({ track: 'kanji', learned: 1, newLeft: 3, newPerDay: 10 })
  })

  it('새 작문 문제: 레벨 · 공부한 한자만 조건, 순서는 쉬운 레벨 → 자주 쓰는 순', async () => {
    const { u, wq } = await start()
    expect((await wq()).map(i => i.cardId)).toEqual([W('日'), W('一'), W('楽'), W('議')]) // 예문 없는 枠 은 없다
    expect((await wq()).every(i => i.isNew && i.drillId === 'kanji-write')).toBe(true)
    expect((await wq('&levels=4,3')).map(i => i.cardId)).toEqual([W('楽'), W('議')])
    expect((await wq('&levels=5&learnedOnly=1')).map(i => i.cardId)).toEqual([])
    expect((await u.answer(R('一'), 'オン')).status).toBe(200)
    expect((await u.answer(R('議'), 'オン')).status).toBe(200)
    expect((await wq('&levels=5&learnedOnly=1')).map(i => i.cardId)).toEqual([W('一')])
    expect((await wq('&learnedOnly=1')).map(i => i.cardId)).toEqual([W('一'), W('議')])
    expect((await wq('&levels=5&learnedOnly=0')).map(i => i.cardId)).toEqual([W('日'), W('一')])
  })

  it('복습할 작문 카드는 고른 레벨과 상관없이 먼저 나온다', async () => {
    const { db, clock, wq, u } = await start()
    expect((await u.answer(W('議'), '議です')).status).toBe(200)
    setDue(db, W('議'), T0 + 1000)
    clock.now = T0 + 5000
    const items = await wq('&levels=5')
    expect(items.map(i => [i.cardId, i.isNew])).toEqual([
      [W('議'), false],
      [W('日'), true],
      [W('一'), true],
    ])
    // 보통 큐에는 나오지 않는다
    expect((await u.queue('kanji')).some(i => i.cardId === W('議'))).toBe(false)
    expect((await u.get('/study/summary')).writing).toMatchObject({ due: 1, learned: 1 })
    expect((await u.get('/study/summary')).tracks[1]).toMatchObject({ due: 0 })
  })

  it('하루 새 문제 수는 보통 한자와 따로 (409)', async () => {
    const { db, u, wq } = await start()
    await u.send('PUT', '/study/settings', { newPerDay: { kanji: 1 }, writeNewPerDay: 2 })
    expect((await wq()).map(i => i.cardId)).toEqual([W('日'), W('一')])
    expect((await u.answer(W('日'), 'x', { selfCorrect: true })).status).toBe(200)
    expect((await u.answer(W('一'), '一です')).status).toBe(200)
    const over = await u.answer(W('楽'), '楽です')
    expect(over.status).toBe(409)
    expect((await over.json()).error).toContain('작문')
    expect((await wq()).filter(i => i.isNew)).toEqual([])
    // 작문 카드 2장은 보통 한자 수에 들어가지 않는다
    expect((await u.queue('kanji')).map(i => i.cardId)).toEqual([R('日')])
    expect((await u.answer(R('日'), 'オン')).status).toBe(200)
    expect((await u.answer(R('一'), 'オン')).status).toBe(409)
    // 보통 한자 수를 다 써도 작문 복습은 된다
    expect((await u.answer(W('日'), '日です')).status).toBe(200)
    expect(db.prepare("SELECT count(*) AS n FROM user_cards WHERE drill_id = 'kanji-write'").get()).toEqual({ n: 2 })
    const s = await u.get('/study/summary')
    expect(s.writing).toEqual({ track: 'kanji', due: 0, newLeft: 0, newPerDay: 2, learned: 2 })
    expect(s.tracks[1]).toMatchObject({ newLeft: 0, newPerDay: 1, learned: 1 })
  })

  it('고르기 화면 수: 레벨별 total · learned · introduced', async () => {
    const { u } = await start()
    expect((await u.answer(R('日'), 'オン')).status).toBe(200)
    expect((await u.answer(R('楽'), 'オン')).status).toBe(200)
    expect((await u.answer(W('日'), '日です')).status).toBe(200)
    expect((await u.answer(W('一'), '一です')).status).toBe(200)
    expect(await u.get('/study/write/options?track=kanji')).toEqual({
      levels: [
        { jlpt: 5, total: 2, learned: 1, introduced: 2, learnedFresh: 0 },
        { jlpt: 4, total: 1, learned: 1, introduced: 0, learnedFresh: 1 },
        { jlpt: 3, total: 1, learned: 0, introduced: 0, learnedFresh: 0 },
      ],
      newPerDay: 10,
      newLeft: 2,
      due: 0,
    })
    expect(await u.get('/study/write/options')).toMatchObject({ newLeft: 2 }) // track 기본 kanji
  })

  it('입력 검사 (400)', async () => {
    const { u } = await start()
    for (const q of [
      'track=kanji&mode=read',
      'track=kana&mode=write',
      'track=kanji&mode=write&levels=',
      'track=kanji&mode=write&levels=0',
      'track=kanji&mode=write&levels=6',
      'track=kanji&mode=write&levels=5,x',
      'track=kanji&mode=write&levels=4.5',
      'track=kanji&mode=write&learnedOnly=yes',
      'track=kanji&levels=5',
      'track=kanji&learnedOnly=1',
    ]) {
      expect((await u.get(`/study/queue?${q}`)).error, q).toBeTruthy()
    }
    expect((await u.get('/study/queue?track=kanji&mode=write&levels=5,5,4&learnedOnly=true')).items).toBeTruthy()
    expect((await u.get('/study/queue?track=kanji&mode=normal')).items).toHaveLength(5)
    expect((await u.get('/study/write/options?track=kana')).error).toBeTruthy()
    expect((await u.get('/study/write/options?track=nope')).error).toBeTruthy()
  })

  it('설정: writeNewPerDay 0–100 정수', async () => {
    const { u } = await start()
    const ok = await u.send('PUT', '/study/settings', { writeNewPerDay: 0 })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ newPerDay: { kana: 15, kanji: 15, toeic: 15, toefl: 15 }, writeNewPerDay: 0 })
    expect((await u.send('PUT', '/study/settings', { writeNewPerDay: 100 })).status).toBe(200)
    for (const bad of [-1, 101, 1.5, '3', null, true]) {
      expect((await u.send('PUT', '/study/settings', { writeNewPerDay: bad })).status, String(bad)).toBe(400)
    }
    // 하나라도 틀리면 아무것도 바뀌지 않는다
    expect((await u.send('PUT', '/study/settings', { newPerDay: { kanji: 3 }, writeNewPerDay: -1 })).status).toBe(400)
    expect(await u.get('/study/settings')).toEqual({ newPerDay: { kana: 15, kanji: 15, toeic: 15, toefl: 15 }, writeNewPerDay: 100 })
    // 쓰기 0 이면 새 작문 문제가 없다
    await u.send('PUT', '/study/settings', { writeNewPerDay: 0 })
    expect((await u.get('/study/queue?track=kanji&mode=write')).items).toEqual([])
    expect((await u.get('/study/summary')).writing).toMatchObject({ newLeft: 0, newPerDay: 0 })
  })
})
