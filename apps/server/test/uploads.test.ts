import { describe, expect, it } from 'vitest'
import type { Note } from '@nakamura/core'
import { HOUR, kst, setup, T0 } from './helpers.ts'

const KANJI = { kanji: '円', on: ['エン'], kun: ['まる.い'], meanings_ko: ['둥글다', '엔'], hunum_ko: '둥글 원', jlpt: 5 }
const TOEIC = {
  word: "Know-how",
  pos: 'n',
  meaning_ko: '노하우, 기술',
  example_en: 'She has the know-how to fix the machine.',
  example_ko: '그녀는 기계를 고칠 노하우가 있다.',
}
const kanjiOf = (ch: string) => ({ ...KANJI, kanji: ch, hunum_ko: undefined })

describe('문제 만들기', () => {
  it('로그인 필요', async () => {
    const { req } = setup({ kana: false })
    expect((await req('POST', '/notes', { track: 'kanji', fields: KANJI })).status).toBe(401)
    expect((await req('GET', '/notes/mine')).status).toBe(401)
  })

  it('한자 초안 저장 · 수정 이력 · 내가 만든 문제', async () => {
    const { db, user } = setup({ kana: false })
    const hana = await user('hana')
    const res = await hana.send('POST', '/notes', { track: 'kanji', fields: { ...KANJI, on: [' エン '], kun: ['まる.い', ''] } })
    expect(res.status).toBe(201)
    const note = await res.json()
    expect(note).toEqual({
      id: 'kanji-円',
      track: 'kanji',
      fields: { ...KANJI, eum_ko: '원' },
      status: 'draft',
      createdAt: T0,
      updatedAt: T0,
    })
    const row = db.prepare('SELECT status, source FROM notes WHERE id = ?').get('kanji-円') as Record<string, unknown>
    expect(row).toEqual({ status: 'draft', source: `upload:${hana.id}` })
    const revs = db.prepare('SELECT status, edited_by AS by, reason FROM note_revisions WHERE note_id = ?').all('kanji-円')
    expect(revs).toEqual([{ status: 'draft', by: hana.id, reason: 'upload' }])

    expect((await hana.get('/notes/mine')).notes).toEqual([note])
    // 초안은 학습 · 공개 목록에 나오지 않는다
    expect((await hana.get('/notes?track=kanji')).notes).toEqual([])
    // 다른 사람 목록에는 없다
    const mina = await user('mina')
    expect((await mina.get('/notes/mine')).notes).toEqual([])
  })

  it('토익: id 는 소문자 · 공백 → - · 아포스트로피 제거, 선택 칸은 비워도 된다', async () => {
    const { user } = setup({ kana: false })
    const hana = await user('hana')
    let res = await hana.send('POST', '/notes', { track: 'toeic', fields: TOEIC })
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe('toeic-know-how')

    res = await hana.send('POST', '/notes', {
      track: 'toeic',
      fields: { word: "Driver's License", pos: '', meaning_ko: '운전면허', example_en: "Bring your driver's license.", example_ko: '운전면허증을 가져오세요.' },
    })
    expect(res.status).toBe(201)
    const note = await res.json()
    expect(note.id).toBe('toeic-drivers-license')
    expect(note.fields.pos).toBeUndefined()
  })

  it('검사 실패는 400 과 문제 목록', async () => {
    const { db, user } = setup({ kana: false })
    const hana = await user('hana')
    const bad = async (body: unknown) => {
      const res = await hana.send('POST', '/notes', body)
      expect(res.status).toBe(400)
      return (await res.json()) as { error: string; errors?: string[] }
    }
    expect((await bad({ track: 'kana', fields: {} })).error).toMatch(/track/)
    expect((await bad({ track: 'kanji', fields: [] })).error).toMatch(/fields/)

    let r = await bad({ track: 'kanji', fields: { kanji: '円', on: ['えん'], kun: [], meanings_ko: [] } })
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/fields\.on: 음독은 가타카나/),
        expect.stringMatching(/fields\.meanings_ko/),
      ]),
    )
    r = await bad({ track: 'kanji', fields: { kanji: '円円', on: ['エン'], kun: [], meanings_ko: ['엔'] } })
    expect(r.errors).toEqual([expect.stringMatching(/한자 한 글자/)])
    r = await bad({ track: 'kanji', fields: { kanji: '円', on: [], kun: [], meanings_ko: ['엔'] } })
    expect(r.errors).toEqual(['음독 · 훈독 중 하나는 있어야 합니다'])
    r = await bad({ track: 'kanji', fields: { ...KANJI, jlpt: 6 } })
    expect(r.errors).toEqual([expect.stringMatching(/fields\.jlpt/)])
    r = await bad({ track: 'kanji', fields: { ...KANJI, hunum_ko: '둥글' } })
    expect(r.errors).toEqual([expect.stringMatching(/fields\.hunum_ko/)])
    r = await bad({ track: 'kanji', fields: { ...KANJI, freq: 1 } })
    expect(r.errors).toEqual(['만들기에서 쓸 수 없는 필드: fields.freq'])
    r = await bad({ track: 'kanji', fields: { on: ['エン'] } })
    expect(r.errors).toEqual(expect.arrayContaining(['fields.kanji 가 없습니다']))

    r = await bad({ track: 'toeic', fields: { ...TOEIC, example_en: 'She can fix the machine.' } })
    expect(r.errors).toEqual(['fields.example_en: 예문에 단어가 들어 있어야 합니다'])
    r = await bad({ track: 'toeic', fields: { ...TOEIC, word: '노하우', example_en: '노하우' } })
    expect(r.errors).toEqual([expect.stringMatching(/영어 단어/)])
    r = await bad({ track: 'toeic', fields: { word: 'invoice', meaning_ko: '송장' } })
    expect(r.errors).toEqual(expect.arrayContaining(['fields.example_en 가 없습니다', 'fields.example_ko 가 없습니다']))
    r = await bad({ track: 'toeic', fields: { ...TOEIC, word: 'a:b', example_en: 'a:b' } })
    expect(r.errors!.some(e => e.includes('id 형식'))).toBe(true)

    expect((db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n).toBe(0)
  })

  it('같은 id 가 있으면 409 (공개 · 초안 · 반려 모두)', async () => {
    const published: Note = { id: 'kanji-日', track: 'kanji', fields: { kanji: '日', on: ['ニチ'], kun: ['ひ'], meanings_ko: ['해'] } }
    const { user } = setup({ kana: false, extra: [published] })
    const hana = await user('hana')
    const mina = await user('mina')
    expect((await hana.send('POST', '/notes', { track: 'kanji', fields: kanjiOf('日') })).status).toBe(409)
    expect((await hana.send('POST', '/notes', { track: 'kanji', fields: kanjiOf('月') })).status).toBe(201)
    expect((await mina.send('POST', '/notes', { track: 'kanji', fields: kanjiOf('月') })).status).toBe(409)
    expect((await hana.send('POST', '/notes', { track: 'toeic', fields: TOEIC })).status).toBe(201)
    expect((await mina.send('POST', '/notes', { track: 'toeic', fields: { ...TOEIC, word: 'know-how' } })).status).toBe(409)
  })

  it('하루 20개 제한 (04:00 에 풀린다)', async () => {
    const { clock, user } = setup({ kana: false })
    const hana = await user('hana')
    const mina = await user('mina')
    const chars = [...'一二三四五六七八九十百千万円年月日火水木金土']
    clock.now = kst('2026-11-09T05:00:00')
    for (const ch of chars.slice(0, 20)) {
      expect((await hana.send('POST', '/notes', { track: 'kanji', fields: kanjiOf(ch) })).status).toBe(201)
    }
    clock.now = kst('2026-11-10T03:59:00')
    const res = await hana.send('POST', '/notes', { track: 'kanji', fields: kanjiOf(chars[20]!) })
    expect(res.status).toBe(429)
    expect((await res.json()).error).toMatch(/20개/)
    // 다른 사람은 따로 센다
    expect((await mina.send('POST', '/notes', { track: 'kanji', fields: kanjiOf(chars[20]!) })).status).toBe(201)
    clock.now = kst('2026-11-10T04:00:00')
    expect((await hana.send('POST', '/notes', { track: 'kanji', fields: kanjiOf(chars[21]!) })).status).toBe(201)
  })
})

describe('검토 대기 (관리자)', () => {
  it('일반 사용자 403 · 로그인 안 됨 401', async () => {
    const { req, user } = setup({ kana: false })
    const hana = await user('hana')
    expect((await req('GET', '/admin/drafts')).status).toBe(401)
    expect((await hana.send('GET', '/admin/drafts', undefined)).status).toBe(403)
    expect((await hana.send('POST', `/admin/drafts/${encodeURIComponent('kanji-円')}/publish`, {})).status).toBe(403)
    expect((await hana.send('POST', `/admin/drafts/${encodeURIComponent('kanji-円')}/reject`, {})).status).toBe(403)
  })

  it('목록 (최근 것부터, 만든 사람) · 공개하면 학습에 들어간다 · 반려', async () => {
    const draftNote: Note = { id: 'kanji-水', track: 'kanji', fields: { kanji: '水', on: ['スイ'], kun: ['みず'], meanings_ko: ['물'] } }
    const { clock, db, user } = setup({ kana: false })
    // 가져오기로 들어온 초안은 검토 대기에 나오지 않는다
    db.prepare("INSERT INTO notes(id, track, fields, status, source, created_at, updated_at) VALUES (?, 'kanji', ?, 'draft', 'ai', 0, 0)").run(
      draftNote.id,
      JSON.stringify(draftNote.fields),
    )
    const admin = await user('boss', { admin: true })
    const hana = await user('hana')
    db.prepare("UPDATE users SET display_name = '하나' WHERE id = ?").run(hana.id)

    clock.now = T0
    expect((await hana.send('POST', '/notes', { track: 'kanji', fields: KANJI })).status).toBe(201)
    clock.now = T0 + HOUR
    expect((await hana.send('POST', '/notes', { track: 'toeic', fields: TOEIC })).status).toBe(201)

    const { drafts } = await admin.get('/admin/drafts')
    expect(drafts.map((d: { id: string }) => d.id)).toEqual(['toeic-know-how', 'kanji-円'])
    expect(drafts[1]).toEqual({
      id: 'kanji-円',
      track: 'kanji',
      fields: { ...KANJI, eum_ko: '원' },
      createdAt: T0,
      uploader: '하나',
      uploaderId: hana.id,
    })

    // 공개 전 학습 큐 · 공개 목록에 없다 (캐시를 한 번 채워 둔다)
    expect((await hana.get('/notes?track=kanji')).notes).toEqual([])
    expect((await hana.get('/study/queue?track=kanji')).items).toEqual([])

    clock.now = T0 + 2 * HOUR
    const enc = encodeURIComponent('kanji-円')
    let res = await admin.send('POST', `/admin/drafts/${enc}/publish`, {})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'kanji-円', status: 'published' })
    const revs = db.prepare('SELECT status, edited_by AS by, reason FROM note_revisions WHERE note_id = ? ORDER BY id').all('kanji-円')
    expect(revs).toEqual([
      { status: 'draft', by: hana.id, reason: 'upload' },
      { status: 'published', by: admin.id, reason: 'publish' },
    ])

    expect((await hana.get('/notes?track=kanji')).notes.map((n: { id: string }) => n.id)).toEqual(['kanji-円'])
    const items = (await hana.get('/study/queue?track=kanji')).items as { noteId: string }[]
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(i => i.noteId === 'kanji-円')).toBe(true)
    expect((await hana.get('/notes/mine')).notes.find((n: { id: string }) => n.id === 'kanji-円').status).toBe('published')

    // 이미 공개한 것 · 없는 것 · 가져오기 초안은 404
    expect((await admin.send('POST', `/admin/drafts/${enc}/publish`, {})).status).toBe(404)
    expect((await admin.send('POST', `/admin/drafts/${enc}/reject`, {})).status).toBe(404)
    expect((await admin.send('POST', '/admin/drafts/kanji-x/publish', {})).status).toBe(404)
    expect((await admin.send('POST', `/admin/drafts/${encodeURIComponent('kanji-水')}/publish`, {})).status).toBe(404)

    res = await admin.send('POST', '/admin/drafts/toeic-know-how/reject', {})
    expect(await res.json()).toEqual({ id: 'toeic-know-how', status: 'retired' })
    expect((await admin.get('/admin/drafts')).drafts).toEqual([])
    expect((await hana.get('/notes?track=toeic')).notes).toEqual([])
    expect((await hana.get('/notes/mine')).notes.map((n: { status: string }) => n.status)).toEqual(['retired', 'published'])
    // 반려된 단어는 다시 만들 수 없다
    expect((await hana.send('POST', '/notes', { track: 'toeic', fields: TOEIC })).status).toBe(409)
  })
})
