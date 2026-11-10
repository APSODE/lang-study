import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deckKey, deckNoteId, type Note } from '@nakamura/core'
import { exportContent, loadContentFiles } from '../src/content.ts'
import { HOUR, kst, setup, T0 } from './helpers.ts'

const KANJI = { kanji: '円', on: ['エン'], kun: ['まる.い'], meanings_ko: ['둥글다', '엔'], hunum_ko: '둥글 원', jlpt: 5 }
const kanjiOf = (ch: string) => ({ kanji: ch, on: ['エン'], kun: [], meanings_ko: ['뜻'] })
const DECK = '일본어 회화 표현'
const CARDS = [
  { front: '잘 먹겠습니다', back: 'いただきます', note: '식사 전 인사' },
  { front: '잘 먹었습니다', back: 'ごちそうさまでした' },
  { front: '다녀오겠습니다', back: 'いってきます' },
]
const cardsOf = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ front: `문장 ${from + i}`, back: `答え ${from + i}` }))

type Result = { no: number; status: string; label: string; id?: string; errors?: string[] }

describe('파일 올리기: 한자 · 토익', () => {
  it('항목마다 결과: 만듦 · 검사 실패 · 이미 있음 · 파일 안 중복. 만든 것은 같은 묶음의 초안', async () => {
    const published: Note = { id: 'kanji-日', track: 'kanji', fields: { kanji: '日', on: ['ニチ'], kun: ['ひ'], meanings_ko: ['해'] } }
    const { db, user } = setup({ kana: false, extra: [published] })
    const hana = await user('hana')
    const res = await hana.send('POST', '/notes/file', {
      track: 'kanji',
      notes: [KANJI, { ...kanjiOf('月'), on: ['げつ'] }, kanjiOf('日'), kanjiOf('円'), 'x', kanjiOf('火')],
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ track: 'kanji', created: 2 })
    expect(body.deck).toBeUndefined()
    expect(typeof body.batch).toBe('string')
    const results = body.results as Result[]
    expect(results.map(r => [r.no, r.status, r.label])).toEqual([
      [1, 'created', '円'],
      [2, 'invalid', '月'],
      [3, 'duplicate', '日'],
      [4, 'duplicate', '円'],
      [5, 'invalid', ''],
      [6, 'created', '火'],
    ])
    expect(results[1]!.errors).toEqual([expect.stringMatching(/음독은 가타카나/)])
    expect(results[2]!.errors).toEqual(['이미 있는 문제입니다'])
    expect(results[3]!.errors).toEqual(['파일 안의 1번과 겹칩니다'])

    const rows = db.prepare("SELECT id, status, source, upload_batch AS batch FROM notes WHERE id != 'kanji-日' ORDER BY rowid").all()
    expect(rows).toEqual([
      { id: 'kanji-円', status: 'draft', source: `upload:${hana.id}`, batch: body.batch },
      { id: 'kanji-火', status: 'draft', source: `upload:${hana.id}`, batch: body.batch },
    ])
    const revs = db.prepare("SELECT note_id AS id, reason FROM note_revisions WHERE reason = 'upload' ORDER BY id").all()
    expect(revs).toEqual([
      { id: 'kanji-円', reason: 'upload' },
      { id: 'kanji-火', reason: 'upload' },
    ])
    // 필드는 직접 만들기와 같은 정리를 거친다 (훈음 → 한국 한자음)
    const mine = (await hana.get('/notes/mine')).notes
    expect(mine.find((n: { id: string }) => n.id === 'kanji-円').fields).toEqual({ ...KANJI, eum_ko: '원' })
  })

  it('토익 파일', async () => {
    const { user } = setup({ kana: false })
    const hana = await user('hana')
    const res = await hana.send('POST', '/notes/file', {
      track: 'toeic',
      notes: [
        { word: 'invoice', meaning_ko: '송장', example_en: 'Send the invoice.', example_ko: '송장을 보내세요.' },
        { word: 'refund', meaning_ko: '환불', example_en: 'No money back.', example_ko: '환불 없음' },
      ],
    })
    const body = await res.json()
    expect(body.created).toBe(1)
    expect((body.results as Result[]).map(r => r.status)).toEqual(['created', 'invalid'])
    expect(body.results[0].id).toBe('toeic-invoice')
    expect(body.results[1].errors).toEqual(['fields.example_en: 예문에 단어가 들어 있어야 합니다'])
  })

  it('파일 형식이 틀리면 400 (아무것도 만들지 않는다)', async () => {
    const { db, user } = setup({ kana: false })
    const hana = await user('hana')
    const bad = async (body: unknown) => {
      const res = await hana.send('POST', '/notes/file', body)
      expect(res.status).toBe(400)
      return (await res.json()).error as string
    }
    expect(await bad([KANJI])).toMatch(/객체/)
    expect(await bad({ items: [] })).toMatch(/track.*deck/)
    expect(await bad({ track: 'kanji', notes: [KANJI], deck: 'x' })).toMatch(/함께/)
    expect(await bad({ track: 'kanji', notes: [KANJI], extra: 1 })).toMatch(/알 수 없는 키: extra/)
    expect(await bad({ track: 'kana', notes: [KANJI] })).toMatch(/track/)
    expect(await bad({ track: 'kanji', notes: [] })).toMatch(/notes/)
    expect(await bad({ track: 'kanji' })).toMatch(/notes/)
    expect(await bad({ deck: '   ', cards: CARDS })).toMatch(/비어/)
    expect(await bad({ deck: 'x'.repeat(41), cards: CARDS })).toMatch(/40자/)
    expect(await bad({ deck: 3, cards: CARDS })).toMatch(/문자열/)
    expect(await bad({ deck: DECK, cards: cardsOf(201) })).toMatch(/200개까지/)
    expect((db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n).toBe(0)
    // 로그인 필요
    const { req } = setup({ kana: false })
    expect((await req('POST', '/notes/file', { deck: DECK, cards: CARDS })).status).toBe(401)
  })
})

describe('파일 올리기: 항목(덱)', () => {
  it('새 항목 만들기 → 같은 이름(공백 · 대소문자 무시)으로 카드 더하기, 같은 앞면은 중복', async () => {
    const { db, user } = setup({ kana: false })
    const hana = await user('hana')
    const mina = await user('mina')
    let res = await hana.send('POST', '/notes/file', { deck: DECK, cards: CARDS })
    expect(res.status).toBe(200)
    let body = await res.json()
    const key = deckKey(DECK)
    expect(body.deck).toEqual({ key, name: DECK, isNew: true })
    expect(body).toMatchObject({ track: 'deck', created: 3 })
    expect(body.results[0]).toEqual({ no: 1, status: 'created', label: '잘 먹겠습니다', id: deckNoteId(DECK, '잘 먹겠습니다') })
    expect(body.results[0].id).toMatch(new RegExp(`^deck-${key}-[0-9a-z]+$`))
    const row = db.prepare('SELECT track, fields, status FROM notes WHERE id = ?').get(body.results[0].id) as Record<string, string>
    expect(row.track).toBe('deck')
    expect(row.status).toBe('draft')
    expect(JSON.parse(row.fields!)).toEqual({ deck: DECK, front: '잘 먹겠습니다', back: 'いただきます', note: '식사 전 인사' })

    // 다른 사람이 같은 항목에 더한다: 이름은 처음 만든 이름으로 맞춘다
    res = await mina.send('POST', '/notes/file', {
      deck: '  일본어   회화 표현 ',
      cards: [
        { front: '잘 먹겠습니다!', back: 'いただきます' },
        { front: '안녕하세요', back: 'こんにちは', note: '' },
        { front: '', back: 'x' },
        { front: '...', back: 'x' },
        { front: '좋아요', back: 'いい', extra: 1 },
        { front: '숫자', back: 3 },
      ],
    })
    body = await res.json()
    expect(body.deck).toEqual({ key, name: DECK, isNew: false })
    expect((body.results as Result[]).map(r => r.status)).toEqual(['duplicate', 'created', 'invalid', 'invalid', 'invalid', 'invalid'])
    expect(body.results[0].errors).toEqual(['이미 있는 문제입니다'])
    expect(body.results[2].errors).toEqual(['fields.front 가 없습니다'])
    expect(body.results[3].errors).toEqual([expect.stringMatching(/글자가 있어야/)])
    expect(body.results[4].errors).toEqual(['알 수 없는 칸: fields.extra'])
    expect(body.results[5].errors).toEqual(['fields.back: 문자열이어야 합니다'])
    const added = JSON.parse((db.prepare('SELECT fields FROM notes WHERE id = ?').get(body.results[1].id) as { fields: string }).fields)
    expect(added).toEqual({ deck: DECK, front: '안녕하세요', back: 'こんにちは' })

    // 다른 이름은 다른 항목
    body = await (await hana.send('POST', '/notes/file', { deck: '여행 영어', cards: CARDS })).json()
    expect(body.deck.isNew).toBe(true)
    expect(body.created).toBe(3)
  })

  it('하루 제한: 파일은 200개 (넘는 항목은 limit 으로 건너뜀, 0 이면 429), 직접 만들기 20개와 따로, 04:00 에 풀린다', async () => {
    const { clock, user } = setup({ kana: false })
    const hana = await user('hana')
    clock.now = kst('2026-11-09T05:00:00')
    let body = await (await hana.send('POST', '/notes/file', { deck: DECK, cards: cardsOf(150) })).json()
    expect(body.created).toBe(150)
    body = await (await hana.send('POST', '/notes/file', { deck: DECK, cards: cardsOf(100, 150) })).json()
    expect(body.created).toBe(50)
    const results = body.results as Result[]
    expect(results.filter(r => r.status === 'limit')).toHaveLength(50)
    expect(results[50]).toMatchObject({ no: 51, status: 'limit', errors: ['하루 200개를 넘어 건너뛰었습니다'] })

    clock.now = kst('2026-11-10T03:59:00')
    const res = await hana.send('POST', '/notes/file', { deck: DECK, cards: cardsOf(1, 300) })
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatch(/200개/)
    // 직접 만들기는 따로 센다
    expect((await hana.send('POST', '/notes', { track: 'kanji', fields: kanjiOf('円') })).status).toBe(201)

    // 다음 날: 같은 파일을 다시 올리면 이미 만든 것은 건너뛰고 나머지만 만든다
    clock.now = kst('2026-11-10T04:00:00')
    body = await (await hana.send('POST', '/notes/file', { deck: DECK, cards: cardsOf(100, 150) })).json()
    expect(body.created).toBe(50)
    expect((body.results as Result[]).filter(r => r.status === 'duplicate')).toHaveLength(50)
  })

  it('64KB 가 넘는 파일도 받는다 (1MB 까지)', async () => {
    const { user } = setup({ kana: false })
    const hana = await user('hana')
    const cards = cardsOf(200).map(c => ({ ...c, note: '설명'.repeat(100) }))
    expect(Buffer.byteLength(JSON.stringify({ deck: DECK, cards }))).toBeGreaterThan(64 * 1024)
    const res = await hana.send('POST', '/notes/file', { deck: DECK, cards })
    expect(res.status).toBe(200)
    expect((await res.json()).created).toBe(200)
    // 다른 요청은 여전히 64KB
    expect((await hana.send('POST', '/notes', { track: 'kanji', fields: { ...KANJI, x: 'a'.repeat(70 * 1024) } })).status).toBe(413)
  })
})

describe('검토 대기: 파일 묶음', () => {
  it('묶음 목록 · 하나씩 공개 · 묶음째 공개 / 반려', async () => {
    const { clock, db, user } = setup({ kana: false })
    const admin = await user('boss', { admin: true })
    const hana = await user('hana')
    db.prepare("UPDATE users SET display_name = '하나' WHERE id = ?").run(hana.id)

    clock.now = T0
    expect((await hana.send('POST', '/notes', { track: 'kanji', fields: KANJI })).status).toBe(201)
    clock.now = T0 + HOUR
    const deckBatch = (await (await hana.send('POST', '/notes/file', { deck: DECK, cards: CARDS })).json()).batch as string
    clock.now = T0 + 2 * HOUR
    const kanjiBatch = (await (await hana.send('POST', '/notes/file', { track: 'kanji', notes: [kanjiOf('月'), kanjiOf('火')] })).json())
      .batch as string

    expect((await hana.send('POST', `/admin/batches/${deckBatch}/publish`, {})).status).toBe(403)

    const list = await admin.get('/admin/drafts')
    expect(list.batches).toEqual([
      { id: kanjiBatch, track: 'kanji', deck: null, count: 2, createdAt: T0 + 2 * HOUR, uploader: '하나', uploaderId: hana.id },
      { id: deckBatch, track: 'deck', deck: DECK, count: 3, createdAt: T0 + HOUR, uploader: '하나', uploaderId: hana.id },
    ])
    // 초안: 최근 것부터, 같은 묶음은 파일 순서
    expect(list.drafts.map((d: { id: string; batch: string | null }) => [d.id, d.batch])).toEqual([
      ['kanji-月', kanjiBatch],
      ['kanji-火', kanjiBatch],
      [deckNoteId(DECK, CARDS[0]!.front), deckBatch],
      [deckNoteId(DECK, CARDS[1]!.front), deckBatch],
      [deckNoteId(DECK, CARDS[2]!.front), deckBatch],
      ['kanji-円', null],
    ])

    // 하나는 따로 반려, 나머지는 묶음째 공개
    clock.now = T0 + 3 * HOUR
    const first = deckNoteId(DECK, CARDS[0]!.front)
    expect((await admin.send('POST', `/admin/drafts/${first}/reject`, {})).status).toBe(200)
    let res = await admin.send('POST', `/admin/batches/${deckBatch}/publish`, {})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ batch: deckBatch, status: 'published', count: 2 })
    const statuses = db.prepare('SELECT status FROM notes WHERE upload_batch = ? ORDER BY rowid').all(deckBatch)
    expect(statuses.map(r => (r as { status: string }).status)).toEqual(['retired', 'published', 'published'])
    const revs = db
      .prepare("SELECT status, edited_by AS by, reason FROM note_revisions WHERE note_id = ? ORDER BY id")
      .all(deckNoteId(DECK, CARDS[1]!.front))
    expect(revs).toEqual([
      { status: 'draft', by: hana.id, reason: 'upload' },
      { status: 'published', by: admin.id, reason: 'publish' },
    ])
    // 이미 끝난 묶음 · 없는 묶음은 404
    expect((await admin.send('POST', `/admin/batches/${deckBatch}/publish`, {})).status).toBe(404)
    expect((await admin.send('POST', '/admin/batches/nope/reject', {})).status).toBe(404)

    res = await admin.send('POST', `/admin/batches/${kanjiBatch}/reject`, {})
    expect(await res.json()).toEqual({ batch: kanjiBatch, status: 'retired', count: 2 })
    const after = await admin.get('/admin/drafts')
    expect(after.batches).toEqual([])
    expect(after.drafts.map((d: { id: string }) => d.id)).toEqual(['kanji-円'])
    // 반려된 것은 다시 올려도 중복
    const again = await (await hana.send('POST', '/notes/file', { track: 'kanji', notes: [kanjiOf('月')] })).json()
    expect(again.results[0].status).toBe('duplicate')
  })
})

describe('항목 학습', () => {
  const publishDeck = async () => {
    const ctx = setup({ kana: false })
    const admin = await ctx.user('boss', { admin: true })
    const hana = await ctx.user('hana')
    ctx.db.prepare("UPDATE users SET display_name = '하나' WHERE id = ?").run(hana.id)
    const up = await (await hana.send('POST', '/notes/file', { deck: DECK, cards: CARDS })).json()
    return { ...ctx, admin, hana, up, key: `deck:${deckKey(DECK)}` }
  }

  it('공개 전에는 없고, 공개하면 항목마다 요약 · 큐 (만든 사람 포함)', async () => {
    const { admin, hana, up, key } = await publishDeck()
    expect((await hana.get('/study/summary')).decks).toEqual([])
    expect((await hana.get(`/study/queue?track=${key}`)).items).toEqual([])

    await admin.send('POST', `/admin/batches/${up.batch}/publish`, {})
    const s = await hana.get('/study/summary')
    expect(s.decks).toEqual([
      { key, name: DECK, authors: ['하나'], notes: 3, due: 0, newLeft: 3, newPerDay: 15, learned: 0, reviewsToday: 0 },
    ])
    // 고정 트랙 요약에는 섞이지 않는다
    expect(s.tracks.map((t: { track: string }) => t.track)).toEqual(['kana', 'kanji', 'toeic'])

    const items = (await hana.get(`/study/queue?track=${encodeURIComponent(key)}`)).items
    expect(items.map((i: { drillId: string }) => i.drillId)).toEqual(['deck-recall', 'deck-recall', 'deck-recall'])
    // 파일 순서대로
    expect(items.map((i: { fields: { front: string } }) => i.fields.front)).toEqual(CARDS.map(c => c.front))
    expect(items[0]).toMatchObject({
      track: 'deck',
      isNew: true,
      author: '하나',
      fields: { deck: DECK, front: '잘 먹겠습니다', back: 'いただきます', note: '식사 전 인사' },
    })
    expect((await hana.get('/study/queue?track=deck:NOPE')).error).toBeDefined()
    expect((await hana.send('GET', '/study/queue?track=deck:x&mode=write', undefined)).status).toBe(400)
  })

  it('답: 정리한 뒤 같으면 정답, 틀려도 자기 평가(selfCorrect) 가능. 카드는 항목 키로 센다', async () => {
    const { admin, db, hana, up, key } = await publishDeck()
    await admin.send('POST', `/admin/batches/${up.batch}/publish`, {})
    const [a, b, c] = (await hana.get(`/study/queue?track=${key}`)).items as { cardId: string }[]
    let r = await (await hana.answer(a!.cardId, ' イタダキマス。 ')).json()
    expect(r).toMatchObject({ correct: true, expected: 'いただきます', rating: 3 })
    r = await (await hana.answer(b!.cardId, 'ごちそうさま')).json()
    expect(r).toMatchObject({ correct: false, rating: 1 })
    r = await (await hana.send('POST', '/study/answer', { cardId: c!.cardId, response: '行ってきます', selfCorrect: true })).json()
    expect(r).toMatchObject({ correct: true, rating: 3 })

    const tracks = db.prepare('SELECT DISTINCT track FROM user_cards').all()
    expect(tracks).toEqual([{ track: key }])
    const s = await hana.get('/study/summary')
    expect(s.decks[0]).toMatchObject({ learned: 3, newLeft: 0, reviewsToday: 3 })
    expect(s.tracks.every((t: { learned: number }) => t.learned === 0)).toBe(true)

    const stats = await hana.get('/stats/tracks')
    expect(stats.decks).toEqual([
      expect.objectContaining({ key, name: DECK, notes: 3, cards: 3, unseen: 0, accuracy7d: 2 / 3 }),
    ])
    expect(stats.tracks).toHaveLength(3)
  })

  it('하루 새 카드 수는 항목마다 따로 (기본 15)', async () => {
    const { user } = setup({ kana: false })
    const a = await user('boss', { admin: true })
    const hana = await user('hana')
    const one = await (await hana.send('POST', '/notes/file', { deck: '하나', cards: cardsOf(20) })).json()
    const two = await (await hana.send('POST', '/notes/file', { deck: '둘', cards: cardsOf(5) })).json()
    await a.send('POST', `/admin/batches/${one.batch}/publish`, {})
    await a.send('POST', `/admin/batches/${two.batch}/publish`, {})
    const s = await hana.get('/study/summary')
    expect(s.decks.map((d: { name: string; newLeft: number }) => [d.name, d.newLeft])).toEqual([
      ['하나', 15],
      ['둘', 5],
    ])
    const k1 = `deck:${deckKey('하나')}`
    const items = (await hana.get(`/study/queue?track=${k1}&limit=100`)).items as { cardId: string }[]
    expect(items).toHaveLength(15)
    for (const it of items) expect((await hana.answer(it.cardId, 'x')).status).toBe(200)
    // 16번째 새 카드는 409 (같은 날)
    const id16 = `${deckNoteId('하나', '문장 15')}:deck-recall`
    expect((await hana.answer(id16, 'x')).status).toBe(409)
    // 다른 항목은 영향 없음
    expect((await hana.get('/study/summary')).decks[1].newLeft).toBe(5)
  })
})

describe('내보내기', () => {
  it('항목 카드는 deck.json 으로 내보내고 다시 가져올 수 있다', async () => {
    const { db, user } = setup({ kana: false })
    const admin = await user('boss', { admin: true })
    const hana = await user('hana')
    const up = await (await hana.send('POST', '/notes/file', { deck: DECK, cards: CARDS })).json()
    await admin.send('POST', `/admin/batches/${up.batch}/publish`, {})
    const dir = mkdtempSync(join(tmpdir(), 'nakamura-export-'))
    const res = exportContent(db, dir)
    expect(res.map(r => [r.track, r.count])).toEqual([['deck', 3]])
    const loaded = loadContentFiles([join(dir, 'deck.json')])
    expect(loaded.map(l => l.note.fields)).toEqual(
      expect.arrayContaining([{ deck: DECK, front: '잘 먹겠습니다', back: 'いただきます', note: '식사 전 인사' }]),
    )
    expect(readFileSync(join(dir, 'deck.json'), 'utf8')).toContain('"track": "deck"')
  })
})
