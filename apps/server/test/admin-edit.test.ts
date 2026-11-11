import { describe, expect, it } from 'vitest'
import { deckNoteId, type Note } from '@nakamura/core'
import { publishedCatalog } from '../src/study/catalog.ts'
import { setup, T0 } from './helpers.ts'

const KANJI = { kanji: '円', on: ['エン'], kun: ['まる.い'], meanings_ko: ['둥글다', '엔'], hunum_ko: '둥글 원', jlpt: 5 }
const TOEIC = {
  word: 'invoice',
  meaning_ko: '송장',
  example_en: 'Please send the invoice by Friday.',
  example_ko: '금요일까지 송장을 보내 주세요.',
}
const DECK = '일본어 회화 표현'
const enc = encodeURIComponent
const revs = (db: ReturnType<typeof setup>['db'], id: string) =>
  db.prepare('SELECT status, edited_by AS by, reason FROM note_revisions WHERE note_id = ? ORDER BY id').all(id)

describe('관리자 문제 수정', () => {
  it('초안 고치기 → 수정 이력 · 공개', async () => {
    const { db, clock, user } = setup({ kana: false })
    const admin = await user('boss', { admin: true })
    const hana = await user('hana')
    expect((await hana.send('POST', '/notes', { track: 'kanji', fields: KANJI })).status).toBe(201)

    clock.now = T0 + 1000
    const res = await admin.send('PATCH', `/admin/notes/${enc('kanji-円')}`, {
      fields: { ...KANJI, meanings_ko: [' 둥글다 ', '일본 돈 엔'], hunum_ko: '둥글 원', eum_ko: '틀림' },
    })
    expect(res.status).toBe(200)
    const note = await res.json()
    expect(note).toMatchObject({ id: 'kanji-円', status: 'draft', updatedAt: T0 + 1000 })
    expect(note.fields).toEqual({ ...KANJI, meanings_ko: ['둥글다', '일본 돈 엔'], eum_ko: '원' })
    expect(revs(db, 'kanji-円')).toEqual([
      { status: 'draft', by: hana.id, reason: 'upload' },
      { status: 'draft', by: admin.id, reason: 'admin-edit' },
    ])
    // 검토 대기 목록에도 고친 내용
    expect((await admin.get('/admin/drafts')).drafts[0].fields.meanings_ko).toEqual(['둥글다', '일본 돈 엔'])
    // 바뀐 것이 없으면 이력을 남기지 않는다
    expect((await admin.send('PATCH', `/admin/notes/${enc('kanji-円')}`, { fields: note.fields })).status).toBe(200)
    expect(revs(db, 'kanji-円')).toHaveLength(2)

    expect((await admin.send('POST', `/admin/drafts/${enc('kanji-円')}/publish`, {})).status).toBe(200)
    expect((await hana.get('/notes?track=kanji')).notes[0].fields.meanings_ko).toEqual(['둥글다', '일본 돈 엔'])
  })

  it('검사 실패 · 대표 칸은 못 고침 · 관리자만 · 고칠 수 없는 노트', async () => {
    const extra: Note = { id: 'kanji-日', track: 'kanji', fields: { kanji: '日', on: ['ニチ'], kun: ['ひ'], meanings_ko: ['해'] } }
    const { db, req, user } = setup({ kana: false, extra: [extra] })
    const admin = await user('boss', { admin: true })
    const hana = await user('hana')
    await hana.send('POST', '/notes', { track: 'kanji', fields: KANJI })
    await hana.send('POST', '/notes', { track: 'toeic', fields: TOEIC })
    const path = `/admin/notes/${enc('kanji-円')}`

    let res = await admin.send('PATCH', path, { fields: { ...KANJI, on: ['えん'], extra: 1 } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors).toContain('fields.on: 음독은 가타카나로 적어 주세요')
    expect(body.errors).toContain('만들기에서 쓸 수 없는 필드: fields.extra')
    expect((await admin.send('PATCH', path, { fields: 'x' })).status).toBe(400)

    // 대표 칸(한자)을 바꾸면 id 가 바뀌므로 400
    res = await admin.send('PATCH', path, { fields: { ...KANJI, kanji: '月' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/한자는 고칠 수 없습니다/)
    // 단어: 대소문자만 바꾸는 것은 id 가 같아 된다, 다른 단어는 안 된다
    const toeic = `/admin/notes/${enc('toeic-invoice')}`
    res = await admin.send('PATCH', toeic, { fields: { ...TOEIC, word: 'Invoice' } })
    expect(res.status).toBe(200)
    res = await admin.send('PATCH', toeic, { fields: { ...TOEIC, word: 'invoices', example_en: 'Send the invoices.' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/단어는 고칠 수 없습니다/)
    res = await admin.send('PATCH', toeic, { fields: { ...TOEIC, example_en: 'No word here.' } })
    expect((await res.json()).errors).toContain('fields.example_en: 예문에 단어가 들어 있어야 합니다')

    expect((await req('PATCH', path, { fields: KANJI })).status).toBe(401)
    expect((await hana.send('PATCH', path, { fields: KANJI })).status).toBe(403)
    // 사전에서 가져온 노트 · 없는 노트 · 반려된 노트는 404
    expect((await admin.send('PATCH', `/admin/notes/${enc('kanji-日')}`, { fields: extra.fields })).status).toBe(404)
    expect((await admin.send('PATCH', '/admin/notes/nope', { fields: KANJI })).status).toBe(404)
    await admin.send('POST', `/admin/drafts/${enc('kanji-円')}/reject`, {})
    expect((await admin.send('PATCH', path, { fields: KANJI })).status).toBe(404)
    expect(revs(db, 'kanji-円').map(r => (r as { reason: string }).reason)).toEqual(['upload', 'reject'])
  })

  it('항목 카드: 뒷면 · 설명은 고치고 항목 이름 · 앞면은 못 고침', async () => {
    const { user } = setup({ kana: false })
    const admin = await user('boss', { admin: true })
    const hana = await user('hana')
    await hana.send('POST', '/notes/file', { deck: DECK, cards: [{ front: '잘 먹겠습니다', back: 'いただきます' }] })
    const id = deckNoteId(DECK, '잘 먹겠습니다')
    const path = `/admin/notes/${enc(id)}`

    let res = await admin.send('PATCH', path, { fields: { deck: DECK, front: '잘 먹겠습니다', back: 'いただきます!', note: '식사 전' } })
    expect(res.status).toBe(200)
    expect((await res.json()).fields).toEqual({ deck: DECK, front: '잘 먹겠습니다', back: 'いただきます!', note: '식사 전' })
    // deck 을 빼고 보내도 된다
    res = await admin.send('PATCH', path, { fields: { front: '잘 먹겠습니다', back: 'いただきます' } })
    expect(res.status).toBe(200)
    expect((await res.json()).fields).toEqual({ deck: DECK, front: '잘 먹겠습니다', back: 'いただきます' })

    expect((await admin.send('PATCH', path, { fields: { deck: '다른 항목', front: '잘 먹겠습니다', back: 'x' } })).status).toBe(400)
    res = await admin.send('PATCH', path, { fields: { front: '잘 먹었습니다', back: 'x' } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/앞면은 고칠 수 없습니다/)
    expect((await admin.send('PATCH', path, { fields: { front: '잘 먹겠습니다', back: '' } })).status).toBe(400)
  })

  it('공개된 문제 고치기: 같은 id(학습 기록 유지), catalog · 신고 화면에 바로 반영', async () => {
    const { db, user } = setup({ kana: false })
    const admin = await user('boss', { admin: true })
    const hana = await user('hana')
    await hana.send('POST', '/notes', { track: 'toeic', fields: TOEIC })
    await admin.send('POST', `/admin/drafts/${enc('toeic-invoice')}/publish`, {})
    expect(publishedCatalog(db, 'toeic').byId.get('toeic-invoice')!.note.fields).toMatchObject({ meaning_ko: '송장' })
    // 학습해서 카드가 생긴다
    const { items } = await hana.get('/study/queue?track=toeic')
    expect((await hana.answer(items[0].cardId, 'x')).status).toBe(200)
    const cards = () => db.prepare("SELECT card_id, fsrs FROM user_cards WHERE note_id = 'toeic-invoice'").all()
    const before = cards()
    expect(before).toHaveLength(1)

    // 신고 화면에서 고칠 수 있다고 알려 준다
    await hana.send('POST', '/reports', { noteId: 'toeic-invoice', reason: 'typo', body: '뜻 오타' })
    const { reports } = await admin.get('/admin/reports')
    expect(reports[0].note).toMatchObject({ status: 'published', editable: true })

    // 같은 밀리초여도 catalog 가 새로 만들어진다
    const res = await admin.send('PATCH', `/admin/notes/${enc('toeic-invoice')}`, { fields: { ...TOEIC, meaning_ko: '송장, 청구서' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'published', fields: { meaning_ko: '송장, 청구서' } })
    expect(publishedCatalog(db, 'toeic').byId.get('toeic-invoice')!.note.fields).toMatchObject({ meaning_ko: '송장, 청구서' })
    expect((await hana.get('/notes?track=toeic')).notes[0].fields.meaning_ko).toBe('송장, 청구서')
    expect(cards()).toEqual(before)
    expect(revs(db, 'toeic-invoice')).toEqual([
      { status: 'draft', by: hana.id, reason: 'upload' },
      { status: 'published', by: admin.id, reason: 'publish' },
      { status: 'published', by: admin.id, reason: 'admin-edit' },
    ])
  })
})
