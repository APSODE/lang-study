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
  it('빈칸: 대소문자 · 악센트 무시', () => {
    const cv: Note = { id: 'toeic-résumé', track: 'toeic', fields: { word: 'résumé', meaning_ko: '이력서', example_en: 'Please send your résumé by Friday.' } }
    expect(check('toeic-cloze', cv, 'Resume')).toBe(true)
    expect(check('toeic-cloze', cv, 'résumé')).toBe(true)
    expect(check('toeic-cloze', cv, 'resumes')).toBe(false)
  })
})

describe('일작 (kanji-write)', () => {
  const withSentence: Note = {
    id: 'kanji-食',
    track: 'kanji',
    fields: {
      ...(eat.fields as object),
      sentences: [{ ja: '友だちとすしを食べます。', kana: 'ともだちとすしをたべます。', ko: '친구와 초밥을 먹습니다.' }],
    } as Note['fields'],
  }
  const run = (r: string) => getDrill('kanji-write')!.check(withSentence, r)

  it('예문이 있을 때만, 다른 한자 연습 방식 뒤에 생긴다 (첫 소개는 kanji-reading)', () => {
    expect(drillsFor(eat).map(d => d.id)).toEqual(['kanji-reading', 'kanji-meaning'])
    expect(drillsFor(withSentence).map(d => d.id)).toEqual(['kanji-reading', 'kanji-meaning', 'kanji-write'])
    expect(getDrill('kanji-write')!.selfGraded).toBe(true)
    expect(getDrill('kanji-reading')!.selfGraded).toBeUndefined()
  })
  it('정답 표시는 한자 표기 ja', () => {
    expect(run('x').expected).toBe('友だちとすしを食べます。')
  })
  it('한자 표기와 같으면 정답: 공백 · 문장 부호 · 전각은 무시', () => {
    expect(run('友だちとすしを食べます。').correct).toBe(true)
    expect(run('友だちとすしを食べます').correct).toBe(true)
    expect(run(' 友だち と すしを 食べます！').correct).toBe(true)
    expect(run('友だちと　すしを食べます?').correct).toBe(true)
  })
  it('가나 전체와 같으면 정답: 가타카나로 써도', () => {
    expect(run('ともだちとすしをたべます').correct).toBe(true)
    expect(run('トモダチトスシヲタベマス。').correct).toBe(true)
    expect(run('ﾄﾓﾀﾞﾁﾄｽｼｦﾀﾍﾞﾏｽ').correct).toBe(true)
  })
  it('다른 표현 · 빈 답은 틀림 (자기 평가로 넘어간다)', () => {
    expect(run('友達とすしを食べます。').correct).toBe(false)
    expect(run('ともだちとすしをたべる').correct).toBe(false)
    expect(run('').correct).toBe(false)
    expect(run('。、 ').correct).toBe(false)
  })
})
