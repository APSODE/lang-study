// 노트: 내용 하나. 트랙마다 필드가 다르다. (docs/논의_정리.md "데이터 모델")
/** 고정 트랙 (홈 · 설정 · 통계 · 친구 진도에 하나씩 나온다) */
export const TRACKS = ['kana', 'kanji', 'toeic'] as const
export type Track = (typeof TRACKS)[number]

/**
 * 사용자가 만든 항목(덱)의 노트 트랙. 앞면 · 뒷면 카드이고, 항목 이름마다 따로 학습한다 (deck.ts).
 * 고정 트랙이 아니라서 TRACKS 에는 없다. 노트 검사 · 연습 방식에서는 트랙처럼 쓴다.
 */
export const DECK_TRACK = 'deck'
export const NOTE_TRACKS = [...TRACKS, DECK_TRACK] as const
export type NoteTrack = (typeof NOTE_TRACKS)[number]

export const KANA_SCRIPTS = ['hiragana', 'katakana'] as const
export type KanaScript = (typeof KANA_SCRIPTS)[number]

export interface KanaFields {
  char: string
  /** 헵번식 (shi, chi, tsu, fu, ji, を = wo) */
  romaji: string
  script: KanaScript
  /** 자음 행: a ka sa … wa n, 탁음은 ga za da ba pa, 요음은 첫 글자의 행 (きゃ → ka, ぎゃ → ga) */
  row: string
  /** 탁음 · 반탁음 */
  dakuon?: boolean
  yoon?: boolean
  /** 로마자만으로 글자가 갈리지 않을 때 문제에 같이 보여줄 설명 (예: ぢ "ち에 탁점") */
  hint?: string
  /**
   * 50음도 표의 자리. 히라가나 · 가타카나가 같은 값을 쓴다.
   * 표의 줄 = floor(order / 5), 칸 = order % 5 (a i u e o 순, 요음은 ya yu yo 를 0 · 2 · 4 칸에).
   * 줄 0–10 기본(あ…ん), 11–15 탁음 · 반탁음(が…ぱ), 16–26 요음(きゃ…ぴゃ).
   */
  order?: number
}

export interface KanjiFields {
  kanji: string
  on: string[]
  kun: string[]
  meanings_ko: string[]
  jlpt?: number
  strokes?: number
  /** 신문 빈도 순위 (KANJIDIC2, 1 = 가장 흔함). 새 카드 순서에 쓴다 */
  freq?: number
  examples?: { word: string; reading: string; meaning_ko: string }[]
  /** 예문 (일작 · 읽기 연습 재료). ja 에 이 한자가 들어 있고, kana 는 ja 전체의 읽기 */
  sentences?: { ja: string; kana: string; ko: string }[]
  /** 한국 한자음, KANJIDIC2 korean_h. 여러 개면 ", " 로 잇는다 (예: "식, 사") */
  eum_ko?: string
  /** 전통 훈음 하나 (예: "먹을 식"). 마지막 낱말은 eum_ko 의 음 중 하나. 国字 등 훈음이 없으면 필드를 뺀다 */
  hunum_ko?: string
  /** KANJIDIC2 영어 뜻. 검토 · 번역 참고용 */
  meanings_en?: string[]
}

export interface ToeicFields {
  word: string
  pos?: string
  meaning_ko: string
  example_en?: string
  example_ko?: string
  list?: 'TSL' | 'NGSL'
}

export interface DeckFields {
  /** 항목 이름 (normDeckName 으로 정리한 값). 대소문자 · 공백만 다른 이름은 같은 항목이다 */
  deck: string
  /** 앞면 (문제) */
  front: string
  /** 뒷면 (답). 답이 여러 개면 '/' 나 ';' 로 나눈다 */
  back: string
  /** 설명 (선택). 답한 뒤에 보여 준다 */
  note?: string
}

export interface FieldsByTrack {
  kana: KanaFields
  kanji: KanjiFields
  toeic: ToeicFields
  deck: DeckFields
}

export interface Note<T extends NoteTrack = NoteTrack> {
  id: string
  track: T
  fields: FieldsByTrack[T]
}

export const isTrack = (v: unknown): v is Track => typeof v === 'string' && (TRACKS as readonly string[]).includes(v)
export const isNoteTrack = (v: unknown): v is NoteTrack => typeof v === 'string' && (NOTE_TRACKS as readonly string[]).includes(v)
