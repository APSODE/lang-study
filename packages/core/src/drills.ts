// 연습 방식(drill): 플러그인처럼 등록한다. 카드 = 노트 × 연습 방식.
// 여기에는 화면과 무관한 부분(대상 트랙, 필요한 필드, 채점)만 둔다.
// 화면(Prompt · Answer)은 apps/web 이 drill id 로 연결한다.
// 발음 평가는 나중에 `speak` 연습 방식 + 서버 Assessor 로 추가한다 — 여기 구조는 바뀌지 않는다.
import type { Note, Track } from './notes.ts'
import { kataToHira, normMeaning, normReading, normRomaji, normSentence, splitMeanings } from './text.ts'

export interface CheckResult {
  correct: boolean
  /** 정답으로 보여줄 값 */
  expected: string
}

export interface Drill {
  id: string
  tracks: readonly Track[]
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
export const writeTracks = (): Track[] => [...new Set(allDrills().filter(d => d.mode === 'write').flatMap(d => d.tracks))]

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

// 토익: 뜻 (고르기 · 입력 공통)
registerDrill({
  id: 'toeic-meaning',
  tracks: ['toeic'],
  requires: ['word', 'meaning_ko'],
  check(note, response) {
    const { meaning_ko } = f<{ meaning_ko: string }>(note)
    const r = normMeaning(response)
    const ok = normMeaning(meaning_ko) === r || splitMeanings(meaning_ko).some(m => normMeaning(m) === r)
    return { correct: r !== '' && ok, expected: meaning_ko }
  },
})

// 토익: 예문 빈칸
registerDrill({
  id: 'toeic-cloze',
  tracks: ['toeic'],
  requires: ['word', 'example_en'],
  check(note, response) {
    const { word } = f<{ word: string }>(note)
    // 대소문자 · 악센트(résumé ↔ resume) 차이는 무시한다
    const plain = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
    return { correct: plain(response) === plain(word), expected: word }
  },
})
