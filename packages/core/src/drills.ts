// 연습 방식(drill): 플러그인처럼 등록한다. 카드 = 노트 × 연습 방식.
// 여기에는 화면과 무관한 부분(대상 트랙, 필요한 필드, 채점)만 둔다.
// 화면(Prompt · Answer)은 apps/web 이 drill id 로 연결한다.
// 발음 평가는 나중에 `speak` 연습 방식 + 서버 Assessor 로 추가한다 — 여기 구조는 바뀌지 않는다.
import { isTrack, WORD_TRACKS, type DeckFields, type Note, type NoteTrack, type Track } from './notes.ts'
import { kataToHira, normAnswer, normMeaning, normReading, normRomaji, normSentence, splitMeanings } from './text.ts'

export interface CheckResult {
  correct: boolean
  /** 정답으로 보여줄 값 */
  expected: string
}

export interface Drill {
  id: string
  tracks: readonly NoteTrack[]
  /** 노트에 이 필드가 모두 비어 있지 않아야 카드가 생긴다 */
  requires: readonly string[]
  /** 사용자의 응답을 채점한다. 서버가 같은 함수로 다시 채점한다. */
  check(note: Note, response: string): CheckResult
  /**
   * 자기 평가: check 가 틀렸다고 해도 사용자가 모범 답안과 비교해 "맞았어요" 를 고를 수 있다.
   * 답이 여러 가지로 나올 수 있는 연습 방식(일작)에만 둔다. 서버는 이 표시가 있는 연습 방식에서만 selfCorrect 를 받는다.
   */
  selfGraded?: true
  /**
   * 학습 모드. 비우면 보통 학습(트랙 큐), 'write' 면 작문 모드에서만 나온다.
   * 작문 카드는 트랙의 보통 큐 · 하루 새 카드 수와 따로 센다 (서버 study/service.ts).
   * 나중에 토익 영작도 같은 표시만 달면 작문 모드에 붙는다.
   */
  mode?: 'write'
}

/** 학습 모드: 'normal' = 연습 방식에 mode 가 없는 것, 'write' = 작문 */
export const STUDY_MODES = ['normal', 'write'] as const
export type StudyMode = (typeof STUDY_MODES)[number]
export const isStudyMode = (v: unknown): v is StudyMode => typeof v === 'string' && (STUDY_MODES as readonly string[]).includes(v)
export const drillMode = (d: Drill): StudyMode => d.mode ?? 'normal'

const registry = new Map<string, Drill>()

export const registerDrill = (d: Drill): void => {
  if (registry.has(d.id)) throw new Error(`연습 방식 id 중복: ${d.id}`)
  registry.set(d.id, d)
}
export const getDrill = (id: string): Drill | undefined => registry.get(id)
export const allDrills = (): Drill[] => [...registry.values()]
/** 그 모드의 연습 방식 id (등록 순서) */
export const drillIdsOf = (mode: StudyMode): string[] => allDrills().filter(d => drillMode(d) === mode).map(d => d.id)
/** 작문 모드가 있는 트랙 */
export const writeTracks = (): Track[] => [...new Set(allDrills().filter(d => d.mode === 'write').flatMap(d => d.tracks))].filter(isTrack)

const filled = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

/** 이 노트로 만들 수 있는 연습 방식들 */
export const drillsFor = (note: Note): Drill[] =>
  allDrills().filter(
    d => d.tracks.includes(note.track) && d.requires.every(k => filled((note.fields as unknown as Record<string, unknown>)[k])),
  )

/** 카드 id = 노트 id + 연습 방식 id */
export const cardId = (noteId: string, drillId: string): string => `${noteId}:${drillId}`

// --- 1차 연습 방식 ---
const f = <T>(note: Note) => note.fields as T

// 가나: 글자 → 로마자
registerDrill({
  id: 'kana-to-romaji',
  tracks: ['kana'],
  requires: ['char', 'romaji'],
  check(note, response) {
    const { romaji } = f<{ romaji: string }>(note)
    return { correct: normRomaji(response) === normRomaji(romaji), expected: romaji }
  },
})

// 가나: 로마자 → 글자 (입력은 wanakana 로 변환된 가나)
registerDrill({
  id: 'romaji-to-kana',
  tracks: ['kana'],
  requires: ['char', 'romaji', 'script'],
  check(note, response) {
    const { char, script } = f<{ char: string; script: string }>(note)
    // 히라가나 문제는 히라가나만, 가타카나 문제는 가타카나만 정답
    const r = response.normalize('NFKC').trim()
    const correct = script === 'katakana' ? r === char : kataToHira(r) === r && r === char
    return { correct, expected: char }
  },
})

// 가나: 듣고 고르기 (응답은 고른 글자)
registerDrill({
  id: 'kana-listen',
  tracks: ['kana'],
  requires: ['char'],
  check(note, response) {
    const { char } = f<{ char: string }>(note)
    return { correct: response.trim() === char, expected: char }
  },
})

// 한자: 읽기 입력 (음독 · 훈독 중 하나라도 맞으면 정답)
registerDrill({
  id: 'kanji-reading',
  tracks: ['kanji'],
  requires: ['kanji'],
  check(note, response) {
    const { on = [], kun = [] } = f<{ on?: string[]; kun?: string[] }>(note)
    const readings = [...on, ...kun]
    const r = normReading(response)
    // 훈독 "た.べる" 는 "たべる" 로 비교
    const correct = r !== '' && readings.some(x => normReading(x) === r)
    return { correct, expected: readings.join('、') }
  },
})

// 한자: 뜻
registerDrill({
  id: 'kanji-meaning',
  tracks: ['kanji'],
  requires: ['kanji', 'meanings_ko'],
  check(note, response) {
    const { meanings_ko } = f<{ meanings_ko: string[] }>(note)
    const r = normMeaning(response)
    return { correct: r !== '' && meanings_ko.some(m => normMeaning(m) === r), expected: meanings_ko.join(', ') }
  },
})

// 한자: 일작 (예문의 한국어 → 일본어). 작문 모드(mode: 'write')라 보통 한자 큐에는 나오지 않는다.
// 한자 표기(ja) 또는 전체 가나(kana)와 같으면 정답. 그 밖의 표현은 사용자가 모범 답안과 비교해 스스로 채점한다.
registerDrill({
  id: 'kanji-write',
  tracks: ['kanji'],
  requires: ['kanji', 'sentences'],
  selfGraded: true,
  mode: 'write',
  check(note, response) {
    const { sentences = [] } = f<{ sentences?: { ja: string; kana: string }[] }>(note)
    const s = sentences[0]
    if (!s) return { correct: false, expected: '' }
    const r = normSentence(response)
    const correct =
      r !== '' && (r === normSentence(s.ja) || kataToHira(r) === kataToHira(normSentence(s.kana)))
    return { correct, expected: s.ja }
  },
})

// 영어 단어(토익 · 토플): 뜻 (고르기 · 입력 공통). 토플도 같은 연습 방식을 쓰고, id 는 기존 카드 기록을 위해 그대로 둔다
registerDrill({
  id: 'toeic-meaning',
  tracks: WORD_TRACKS,
  requires: ['word', 'meaning_ko'],
  check(note, response) {
    const { meaning_ko } = f<{ meaning_ko: string }>(note)
    const r = normMeaning(response)
    const ok = normMeaning(meaning_ko) === r || splitMeanings(meaning_ko).some(m => normMeaning(m) === r)
    return { correct: r !== '' && ok, expected: meaning_ko }
  },
})

/** 영어 단어 비교용: 대소문자 · 악센트(résumé ↔ resume) · 앞뒤 공백 차이는 무시한다 */
const plainWord = (x: string): string => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

// 영어 단어(토익 · 토플): 예문 빈칸
registerDrill({
  id: 'toeic-cloze',
  tracks: WORD_TRACKS,
  requires: ['word', 'example_en'],
  check(note, response) {
    const { word } = f<{ word: string }>(note)
    return { correct: plainWord(response) === plainWord(word), expected: word }
  },
})

/**
 * 철자 채우기 힌트: 공백 · 하이픈으로 나눈 부분마다 앞 글자 ceil(n/2) 개만 보이고 나머지는 `_` 로 가린다.
 * 2글자 이하인 부분은 첫 글자만 보인다. 아포스트로피 · 마침표 · 하이픈 · 공백은 그대로 둔다(글자 수에 넣지 않는다).
 * 예: accurate → accu____, know-how → kn__-ho_, it's → it'_, on → o_
 */
export const spellMask = (word: string): string =>
  word
    .normalize('NFC')
    .split(/([\s-]+)/)
    .map((part, i) => {
      if (i % 2 === 1) return part // 구분자
      const chars = Array.from(part)
      const isMark = (c: string) => c === "'" || c === '\u2019' || c === '.'
      const n = chars.filter(c => !isMark(c)).length
      const keep = n <= 2 ? 1 : Math.ceil(n / 2)
      let seen = 0
      return chars.map(c => (isMark(c) ? c : seen++ < keep ? c : '_')).join('')
    })
    .join('')

// 영어 단어(토익 · 토플): 철자 채우기 (토플 2026 Complete the Words 식). 뜻과 가린 단어(spellMask)를 보고 단어 전체를 쓴다.
// 등록 순서가 뜻 · 빈칸 뒤라서, 같은 단어의 철자 카드는 뜻 카드 다음 날부터 후속 카드로 나온다 (서버 newCandidates).
registerDrill({
  id: 'word-spell',
  tracks: WORD_TRACKS,
  requires: ['word', 'meaning_ko'],
  check(note, response) {
    const { word } = f<{ word: string }>(note)
    return { correct: plainWord(response) === plainWord(word), expected: word }
  },
})

// 항목(사용자가 만든 덱): 앞면을 보고 뒷면을 쓴다. 뒷면 전체 또는 '/' · ';' 로 나눈 답 중 하나와 같으면 정답
// (공백 · 문장 부호 · 대소문자 · 히라가나/가타카나 차이는 무시). 답이 여러 가지로 나올 수 있어 자기 평가.
registerDrill({
  id: 'deck-recall',
  tracks: ['deck'],
  requires: ['front', 'back'],
  selfGraded: true,
  check(note, response) {
    const { back } = f<DeckFields>(note)
    const r = normAnswer(response)
    const answers = [back, ...back.split(/[/;]/)].map(normAnswer).filter(Boolean)
    return { correct: r !== '' && answers.includes(r), expected: back }
  },
})
