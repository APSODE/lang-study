import { describe, expect, it } from 'vitest'
import { drillsFor, getDrill, type Note } from '../src/index.ts'

const ka: Note = { id: 'kana-ka', track: 'kana', fields: { char: 'か', romaji: 'ka', script: 'hiragana', row: 'k' } }
const shi: Note = { id: 'kana-shi', track: 'kana', fields: { char: 'シ', romaji: 'shi', script: 'katakana', row: 's' } }
const eat: Note = {
  id: 'kanji-食',
  track: 'kanji',
  fields: { kanji: '食', on: ['ショク', 'ジキ'], kun: ['く.う', 'た.べる'], meanings_ko: ['먹다', '음식'] },
}
const bare: Note = { id: 'toeic-x', track: 'toeic', fields: { word: 'invoice', meaning_ko: '송장, 청구서' } }

const check = (drill: string, note: Note, r: string) => getDrill(drill)!.check(note, r).correct

describe('drillsFor', () => {
  it('트랙과 필요한 필드로 카드를 만든다', () => {
    expect(drillsFor(ka).map(d => d.id)).toEqual(['kana-to-romaji', 'romaji-to-kana', 'kana-listen'])
    // example_en 이 없으면 빈칸 문제는 생기지 않는다
    expect(drillsFor(bare).map(d => d.id)).toEqual(['toeic-meaning'])
  })
})

describe('채점', () => {
  it('로마자: 헵번식 · 훈령식 모두 정답', () => {
    expect(check('kana-to-romaji', shi, 'shi')).toBe(true)
    expect(check('kana-to-romaji', shi, 'si')).toBe(true)
    expect(check('kana-to-romaji', shi, 'su')).toBe(false)
  })
  it('글자 입력: 히라가나와 가타카나를 구분한다', () => {
    expect(check('romaji-to-kana', ka, 'か')).toBe(true)
    expect(check('romaji-to-kana', ka, 'カ')).toBe(false)
    expect(check('romaji-to-kana', shi, 'シ')).toBe(true)
    expect(check('romaji-to-kana', shi, 'し')).toBe(false)
  })
  it('한자 읽기: 음독은 히라가나로 입력해도, 훈독은 구분점 없이', () => {
    expect(check('kanji-reading', eat, 'しょく')).toBe(true)
    expect(check('kanji-reading', eat, 'たべる')).toBe(true)
    expect(check('kanji-reading', eat, 'のむ')).toBe(false)
    expect(check('kanji-reading', eat, '')).toBe(false)
  })
  it('뜻: 쉼표로 나뉜 뜻 중 하나', () => {
    expect(check('toeic-meaning', bare, '청구서')).toBe(true)
    expect(check('toeic-meaning', bare, '송장, 청구서')).toBe(true)
    expect(check('toeic-meaning', bare, '영수증')).toBe(false)
  })
})
