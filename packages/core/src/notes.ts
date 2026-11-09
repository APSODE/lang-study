// 노트: 내용 하나. 트랙마다 필드가 다르다. (docs/논의_정리.md "데이터 모델")
export const TRACKS = ['kana', 'kanji', 'toeic'] as const
export type Track = (typeof TRACKS)[number]

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
  examples?: { word: string; reading: string; meaning_ko: string }[]
}

export interface ToeicFields {
  word: string
  pos?: string
  meaning_ko: string
  example_en?: string
  example_ko?: string
  list?: 'TSL' | 'NGSL'
}

export interface FieldsByTrack {
  kana: KanaFields
  kanji: KanjiFields
  toeic: ToeicFields
}

export interface Note<T extends Track = Track> {
  id: string
  track: T
  fields: FieldsByTrack[T]
}

export const isTrack = (v: unknown): v is Track => typeof v === 'string' && (TRACKS as readonly string[]).includes(v)
