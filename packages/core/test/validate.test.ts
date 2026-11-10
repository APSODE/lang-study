import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deckKey, deckNoteId, drillsFor, kataToHira, validateNote, type KanaFields, type Note } from '../src/index.ts'

const ka = { id: 'kana-hira-ka', track: 'kana', fields: { char: 'か', romaji: 'ka', script: 'hiragana', row: 'ka' } }

describe('validateNote', () => {
  it('올바른 노트는 통과한다', () => {
    expect(validateNote(ka)).toEqual([])
    expect(
      validateNote({
        id: 'kanji-食',
        track: 'kanji',
        fields: { kanji: '食', on: ['ショク'], kun: ['た.べる'], meanings_ko: ['먹다'], jlpt: 5, strokes: 9 },
      }),
    ).toEqual([])
    expect(validateNote({ id: 'toeic-invoice', track: 'toeic', fields: { word: 'invoice', meaning_ko: '송장', list: 'TSL' } })).toEqual(
      [],
    )
  })
  it('토플: 토익과 같은 필드, 단어 목록 NAWL', () => {
    const hyp = { id: 'toefl-hypothesis', track: 'toefl', fields: { word: 'hypothesis', pos: 'n', meaning_ko: '가설', list: 'NAWL' } }
    expect(validateNote(hyp)).toEqual([])
    expect(validateNote({ ...hyp, fields: { ...hyp.fields, example_en: 'The data support the hypothesis.', example_ko: '자료가 가설을 뒷받침한다.' } })).toEqual([])
    expect(validateNote({ ...hyp, fields: { ...hyp.fields, list: 'AWL' } })[0]).toMatch(/fields\.list/)
    expect(validateNote({ ...hyp, fields: { word: 'hypothesis' } })[0]).toMatch(/meaning_ko/)
    expect(validateNote({ ...hyp, fields: { ...hyp.fields, kanji: '仮' } })[0]).toMatch(/알 수 없는 필드/)
    expect(validateNote({ ...hyp, id: 'toeic-hypothesis' })[0]).toMatch(/트랙/)
    // 토익은 NAWL 을 받지 않는다
    expect(validateNote({ ...hyp, id: 'toeic-hypothesis', track: 'toeic' })[0]).toMatch(/fields\.list/)
  })
  it('id 형식', () => {
    expect(validateNote({ ...ka, id: 'kana hira ka' })).toHaveLength(1)
    expect(validateNote({ ...ka, id: 'kana-hira:ka' })).toHaveLength(1)
    expect(validateNote({ ...ka, id: 'kanji-ka' })[0]).toMatch(/트랙/)
    expect(validateNote({ ...ka, id: 7 })).toHaveLength(1)
  })
  it('트랙 · 필드', () => {
    expect(validateNote({ ...ka, track: 'ielts' }).join()).toMatch(/트랙/)
    expect(validateNote({ ...ka, fields: { ...ka.fields, script: 'kanji' } })).toHaveLength(1)
    expect(validateNote({ ...ka, fields: { ...ka.fields, romaji: '' } })).toHaveLength(1)
    expect(validateNote({ ...ka, fields: { char: 'か', romaji: 'ka', script: 'hiragana' } })[0]).toMatch(/row/)
    expect(validateNote({ ...ka, fields: { ...ka.fields, romanji: 'ka' } })[0]).toMatch(/알 수 없는 필드/)
    expect(validateNote({ ...ka, fields: { ...ka.fields, order: -1 } })).toHaveLength(1)
    expect(validateNote({ ...ka, extra: 1 })).toHaveLength(1)
    expect(validateNote({ id: 'kanji-食', track: 'kanji', fields: { kanji: '食', on: 'ショク', kun: [], meanings_ko: [] } })).toHaveLength(1)
    expect(validateNote(null)).toHaveLength(1)
    expect(validateNote({ ...ka, fields: [] })).toHaveLength(1)
  })
  it('한자 선택 필드: eum_ko · hunum_ko · meanings_en', () => {
    const shoku = { kanji: '食', on: ['ショク'], kun: ['た.べる'], meanings_ko: ['먹다'] }
    const note = (extra: Record<string, unknown>) => ({ id: 'kanji-食', track: 'kanji', fields: { ...shoku, ...extra } })
    expect(validateNote(note({ eum_ko: '식, 사', hunum_ko: '먹을 식', meanings_en: ['eat', 'food'] }))).toEqual([])
    expect(validateNote(note({ eum_ko: '식' }))).toEqual([])
    expect(validateNote(note({ hunum_ko: '돌아올 회' }))).toEqual([])
    for (const eum_ko of ['', '식,사', 'sik', '식사', ['식']]) expect(validateNote(note({ eum_ko })), String(eum_ko)).toHaveLength(1)
    for (const hunum_ko of ['', '식', '먹을식', '먹을 식사', 'eat 식', ' 먹을 식']) expect(validateNote(note({ hunum_ko })), hunum_ko).toHaveLength(1)
    expect(validateNote(note({ meanings_en: 'eat' }))).toHaveLength(1)
    expect(validateNote(note({ meanings_en: [''] }))).toHaveLength(1)
  })
  it('항목(deck): id 는 deck-<이름 키>-…, 이름은 정리된 40자 이하', () => {
    const fields = { deck: '회화', front: '안녕', back: 'こんにちは' }
    const id = deckNoteId('회화', '안녕')
    expect(validateNote({ id, track: 'deck', fields })).toEqual([])
    expect(validateNote({ id, track: 'deck', fields: { ...fields, note: '인사' } })).toEqual([])
    expect(validateNote({ id: deckNoteId('여행', '안녕'), track: 'deck', fields }).join()).toMatch(/항목 이름과 맞지 않습니다/)
    expect(validateNote({ id: `deck-${deckKey('회화')}-X`, track: 'deck', fields }).join()).toMatch(/항목 이름과 맞지 않습니다/)
    expect(validateNote({ id, track: 'deck', fields: { ...fields, deck: ' 회화' } }).join()).toMatch(/fields\.deck/)
    expect(validateNote({ id, track: 'deck', fields: { ...fields, deck: 'x'.repeat(41) } }).join()).toMatch(/fields\.deck/)
    expect(validateNote({ id, track: 'deck', fields: { ...fields, back: '' } })).toEqual(['fields.back: 비어 있지 않은 문자열이어야 합니다'])
    expect(validateNote({ id, track: 'deck', fields: { ...fields, hint: 'x' } })).toEqual(['알 수 없는 필드: fields.hint'])
  })
})

describe('content/kana.json', () => {
  const notes = JSON.parse(readFileSync(join(import.meta.dirname, '../../../content/kana.json'), 'utf8')) as Note<'kana'>[]

  it('모두 올바르고 id 가 겹치지 않는다', () => {
    expect(notes).toHaveLength(208)
    for (const n of notes) expect(validateNote(n), n.id).toEqual([])
    expect(new Set(notes.map(n => n.id)).size).toBe(notes.length)
  })
  it('노트마다 연습 방식 3개', () => {
    for (const n of notes) expect(drillsFor(n).map(d => d.id), n.id).toEqual(['kana-to-romaji', 'romaji-to-kana', 'kana-listen'])
  })
  it('글자마다 104개씩, 로마자 + 설명으로 글자가 하나로 정해진다', () => {
    for (const script of ['hiragana', 'katakana'] as const) {
      const xs = notes.filter(n => n.fields.script === script).map(n => n.fields)
      expect(xs).toHaveLength(104)
      expect(new Set(xs.map(f => `${f.romaji}|${f.hint ?? ''}`)).size).toBe(104)
      expect(new Set(xs.map(f => f.char)).size).toBe(104)
      expect(new Set(xs.map(f => f.order)).size).toBe(104)
    }
  })
  it('가타카나는 같은 자리의 히라가나와 짝이 맞는다', () => {
    const hira = new Map<number, KanaFields>()
    for (const n of notes) if (n.fields.script === 'hiragana') hira.set(n.fields.order!, n.fields)
    for (const n of notes.filter(n => n.fields.script === 'katakana')) {
      const h = hira.get(n.fields.order!)!
      expect(kataToHira(n.fields.char), n.id).toBe(h.char)
      expect({ ...n.fields, char: h.char, script: 'hiragana', hint: h.hint }).toEqual(h)
      expect(n.id.replace('kana-kata-', 'kana-hira-')).toBe(notes.find(x => x.fields === h)!.id)
    }
  })
})
