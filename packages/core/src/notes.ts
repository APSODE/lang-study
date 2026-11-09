// 노트: 내용 하나. 트랙마다 필드가 다르다. (docs/논의_정리.md "데이터 모델")
export const TRACKS = ['kana', 'kanji', 'toeic'] as const
export type Track = (typeof TRACKS)[number]

export interface KanaFields {
  char: string
  romaji: string
  script: 'hiragana' | 'katakana'
  row: string
  dakuon?: boolean
  yoon?: boolean
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
