// 항목(덱): 사용자가 파일로 만든 앞면 · 뒷면 카드 묶음 (docs/논의_정리.md "파일 올리기").
// - 노트 트랙은 'deck', 필드는 { deck, front, back, note? }.
// - 노트 id = deck-<항목 키>-<앞면 키>. 키는 이름 · 앞면을 정리한 뒤 만든 해시라 같은 항목 · 같은 앞면은 같은 id 가 된다
//   (같은 앞면을 다시 올리면 중복으로 건너뛴다).
// - 학습 키: 고정 트랙은 트랙 이름, 항목은 'deck:<항목 키>'. 큐 · 하루 새 카드 · 통계를 이 키로 나눈다
//   (서버 user_cards.track · user_track_settings.track 에 이 값이 들어간다).
import { isTrack, type NoteTrack, type Track } from './notes.ts'
import { normAnswer } from './text.ts'

/** 항목 이름 최대 길이 */
export const DECK_NAME_MAX = 40

/** 항목 이름 정리: NFC, 앞뒤 공백 제거, 연속 공백 하나로 */
export const normDeckName = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ')

/** 53비트 문자열 해시 (cyrb53) → 11자리 36진수. 브라우저 · 서버가 같은 값을 낸다 */
const hash = (s: string): string => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0')
}

/** 항목 키: 이름을 정리하고 소문자로 바꾼 값의 해시 */
export const deckKey = (name: string): string => hash(normDeckName(name).toLowerCase())

/** 항목 노트 id. 앞면은 채점과 같은 정리(normAnswer)를 한 뒤 해시한다 → 공백 · 문장 부호 · 대소문자만 다른 앞면은 중복 */
export const deckNoteId = (deck: string, front: string): string => `deck-${deckKey(deck)}-${hash(normAnswer(front))}`

const DECK_ID_RE = /^deck-([0-9a-z]+)-[0-9a-z]+$/

/** 노트 id 의 항목 키. 항목 노트 id 가 아니면 null */
export const deckKeyOfNoteId = (id: string): string | null => DECK_ID_RE.exec(id)?.[1] ?? null

/** 항목의 학습 키 */
export type DeckStudyKey = `deck:${string}`
/** 학습 키: 고정 트랙 또는 항목 */
export type StudyKey = Track | DeckStudyKey

export const DECK_STUDY_KEY_RE = /^deck:[0-9a-z]{1,16}$/
export const deckStudyKey = (key: string): DeckStudyKey => `deck:${key}`
export const isDeckStudyKey = (v: unknown): v is DeckStudyKey => typeof v === 'string' && DECK_STUDY_KEY_RE.test(v)
export const isStudyKey = (v: unknown): v is StudyKey => isTrack(v) || isDeckStudyKey(v)
/** 'deck:<키>' → '<키>' */
export const deckKeyOfStudyKey = (k: DeckStudyKey): string => k.slice('deck:'.length)

/** 노트가 속한 학습 키. 항목 노트인데 id 가 형식에 맞지 않거나 모르는 트랙이면 null */
export const studyKeyOf = (note: { id: string; track: NoteTrack | string }): StudyKey | null => {
  if (note.track === 'deck') {
    const k = deckKeyOfNoteId(note.id)
    return k ? deckStudyKey(k) : null
  }
  return isTrack(note.track) ? note.track : null
}
