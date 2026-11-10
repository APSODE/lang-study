import { describe, expect, it } from 'vitest'
import {
  deckKey,
  deckKeyOfNoteId,
  deckNoteId,
  drillIdsOf,
  drillMode,
  drillsFor,
  exampleIndex,
  getDrill,
  isStudyKey,
  isTrack,
  spellMask,
  studyKeyOf,
  writeTracks,
  type Note,
} from '../src/index.ts'

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
    expect(drillsFor(bare).map(d => d.id)).toEqual(['toeic-meaning', 'word-spell'])
  })
  it('토플은 토익 연습 방식(뜻 · 빈칸)을 같은 id 로 쓴다', () => {
    const hyp: Note = {
      id: 'toefl-hypothesis',
      track: 'toefl',
      fields: { word: 'hypothesis', meaning_ko: '가설', example_en: 'The data support the hypothesis.', list: 'NAWL' },
    }
    expect(drillsFor(hyp).map(d => d.id)).toEqual(['toeic-meaning', 'toeic-cloze', 'word-spell'])
    expect(check('toeic-meaning', hyp, '가설')).toBe(true)
    expect(check('toeic-cloze', hyp, 'Hypothesis')).toBe(true)
    expect(isTrack('toefl')).toBe(true)
    expect(writeTracks()).not.toContain('toefl')
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

describe('철자 채우기 (word-spell)', () => {
  it('정답은 단어 전체 (대소문자 · 악센트 · 앞뒤 공백 무시)', () => {
    expect(check('word-spell', bare, 'invoice')).toBe(true)
    expect(check('word-spell', bare, ' Invoice ')).toBe(true)
    expect(check('word-spell', bare, 'invoices')).toBe(false)
    expect(check('word-spell', bare, 'invo')).toBe(false)
    expect(check('word-spell', bare, '')).toBe(false)
    const cv: Note = { id: 'toeic-résumé', track: 'toeic', fields: { word: 'résumé', meaning_ko: '이력서' } }
    expect(check('word-spell', cv, 'resume')).toBe(true)
    expect(getDrill('word-spell')!.check(cv, 'x').expected).toBe('résumé')
    expect(getDrill('word-spell')!.selfGraded).toBeUndefined()
    expect(drillMode(getDrill('word-spell')!)).toBe('normal')
  })
  it('spellMask: 부분마다 앞 절반(올림)만 보인다', () => {
    expect(spellMask('accurate')).toBe('accu____')
    expect(spellMask('invoice')).toBe('invo___')
    expect(spellMask('fee')).toBe('fe_')
    expect(spellMask('on')).toBe('o_')
    expect(spellMask('a')).toBe('a')
    expect(spellMask('know-how')).toBe('kn__-ho_')
    expect(spellMask('take over')).toBe('ta__ ov__')
    expect(spellMask("driver's license")).toBe("driv__'_ lice___")
    expect(spellMask('e.g.')).toBe('e._.')
    expect(spellMask('résumé')).toBe('rés___')
    // 같은 입력이면 늘 같은 결과
    expect(spellMask('hypothesis')).toBe(spellMask('hypothesis'))
    expect(spellMask('hypothesis')).toBe('hypot_____')
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
  it('작문 모드: kanji-write 만 mode write, 나머지는 보통 학습', () => {
    expect(drillMode(getDrill('kanji-write')!)).toBe('write')
    expect(drillMode(getDrill('kanji-reading')!)).toBe('normal')
    expect(drillIdsOf('write')).toEqual(['kanji-write'])
    expect(drillIdsOf('normal')).not.toContain('kanji-write')
    expect(writeTracks()).toEqual(['kanji'])
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

describe('항목 (deck-recall)', () => {
  const card: Note = {
    id: deckNoteId('회화', '잘 먹겠습니다'),
    track: 'deck',
    fields: { deck: '회화', front: '잘 먹겠습니다', back: 'いただきます', note: '식사 전 인사' },
  }
  const multi: Note = { id: deckNoteId('영어', 'big'), track: 'deck', fields: { deck: '영어', front: 'big', back: 'Large / huge; Great Britain' } }

  it('앞면 · 뒷면이 있으면 deck-recall 카드 하나, 자기 평가', () => {
    expect(drillsFor(card).map(d => d.id)).toEqual(['deck-recall'])
    expect(getDrill('deck-recall')!.selfGraded).toBe(true)
    expect(drillMode(getDrill('deck-recall')!)).toBe('normal')
    expect(writeTracks()).toEqual(['kanji'])
  })
  it('공백 · 문장 부호 · 가타카나/히라가나 · 대소문자는 무시', () => {
    expect(check('deck-recall', card, 'いただきます')).toBe(true)
    expect(check('deck-recall', card, ' イタダキマス。')).toBe(true)
    expect(check('deck-recall', card, 'いただきま')).toBe(false)
    expect(check('deck-recall', card, '')).toBe(false)
    expect(check('deck-recall', card, '。')).toBe(false)
    expect(getDrill('deck-recall')!.check(card, 'x').expected).toBe('いただきます')
  })
  it("'/' · ';' 로 나눈 답 중 하나면 정답, 쉼표로는 나누지 않는다", () => {
    expect(check('deck-recall', multi, 'large')).toBe(true)
    expect(check('deck-recall', multi, 'HUGE')).toBe(true)
    expect(check('deck-recall', multi, 'great britain')).toBe(true)
    expect(check('deck-recall', multi, 'Large / huge; Great Britain')).toBe(true)
    expect(check('deck-recall', multi, 'great')).toBe(false)
  })
})

describe('항목 키 · 학습 키', () => {
  it('이름은 공백 · 대소문자를 무시하고 같은 키, 앞면은 문장 부호 · 공백 차이를 무시', () => {
    expect(deckKey('Travel  English')).toBe(deckKey(' travel english '))
    expect(deckKey('Travel English')).not.toBe(deckKey('Travel Japanese'))
    expect(deckKey('회화')).toMatch(/^[0-9a-z]{11}$/)
    expect(deckNoteId('회화', '잘 먹겠습니다!')).toBe(deckNoteId('회화', '잘먹겠습니다'))
    expect(deckNoteId('회화', '잘 먹겠습니다')).not.toBe(deckNoteId('회화', '잘 먹었습니다'))
    expect(deckNoteId('회화', 'x')).toMatch(new RegExp(`^deck-${deckKey('회화')}-[0-9a-z]{11}$`))
  })
  it('studyKeyOf · isStudyKey', () => {
    const id = deckNoteId('회화', 'x')
    expect(deckKeyOfNoteId(id)).toBe(deckKey('회화'))
    expect(studyKeyOf({ id, track: 'deck' })).toBe(`deck:${deckKey('회화')}`)
    expect(studyKeyOf({ id: 'deck-bad id', track: 'deck' })).toBeNull()
    expect(studyKeyOf({ id: 'kanji-食', track: 'kanji' })).toBe('kanji')
    expect(isStudyKey('kana')).toBe(true)
    expect(isStudyKey(`deck:${deckKey('회화')}`)).toBe(true)
    expect(isStudyKey('deck')).toBe(false)
    expect(isStudyKey('deck:ABC')).toBe(false)
    expect(isTrack('deck')).toBe(false)
  })
})

describe('예시 낱말 (kanji-word-meaning · kanji-word-reading)', () => {
  const study: Note = {
    id: 'kanji-学',
    track: 'kanji',
    fields: {
      kanji: '学',
      on: ['ガク'],
      kun: ['まな.ぶ'],
      meanings_ko: ['배우다'],
      examples: [
        { word: '学生', reading: 'がくせい', meaning_ko: '학생' },
        { word: '大学', reading: 'だいがく', meaning_ko: '대학 (교)' },
      ],
    },
  }
  const run = (drill: string, r: string, example?: number) => getDrill(drill)!.check(study, r, { example })

  it('예시 낱말이 있을 때만, 다른 한자 연습 방식 뒤에 (보통 모드, 읽기는 뜻 카드가 선행)', () => {
    expect(drillsFor(eat).map(d => d.id)).toEqual(['kanji-reading', 'kanji-meaning'])
    expect(drillsFor(study).map(d => d.id)).toEqual(['kanji-reading', 'kanji-meaning', 'kanji-word-meaning', 'kanji-word-reading'])
    expect(drillIdsOf('normal')).toContain('kanji-word-reading')
    expect(drillIdsOf('write')).toEqual(['kanji-write'])
    expect(getDrill('kanji-word-reading')!.after).toBe('kanji-word-meaning')
  })
  it('뜻: 고른 순번의 낱말 뜻만 정답 (괄호 · 공백 무시)', () => {
    expect(run('kanji-word-meaning', '학생')).toEqual({ correct: true, expected: '학생' })
    expect(run('kanji-word-meaning', '학생', 0).correct).toBe(true)
    expect(run('kanji-word-meaning', '대학', 0).correct).toBe(false)
    expect(run('kanji-word-meaning', '대학', 1)).toEqual({ correct: true, expected: '대학 (교)' })
    expect(run('kanji-word-meaning', '', 1).correct).toBe(false)
    expect(run('kanji-word-meaning', '학생', 5)).toEqual({ correct: false, expected: '' })
  })
  it('읽기: 고른 순번의 낱말 읽기만 정답 (가타카나도 같게)', () => {
    expect(run('kanji-word-reading', 'がくせい', 0)).toEqual({ correct: true, expected: 'がくせい' })
    expect(run('kanji-word-reading', 'ガクセイ', 0).correct).toBe(true)
    expect(run('kanji-word-reading', 'だいがく', 0).correct).toBe(false)
    expect(run('kanji-word-reading', 'だいがく', 1).correct).toBe(true)
  })
  it('exampleIndex: 복습 횟수로 돌아가며 고른다', () => {
    expect([0, 1, 2, 3].map(r => exampleIndex(study, r))).toEqual([0, 1, 0, 1])
    expect(exampleIndex(eat, 3)).toBe(0)
  })
})
