// 연습 방식 id → 화면. 채점(check)은 @nakamura/core 레지스트리에 있고, 여기에는 화면만 둔다.
// 새 연습 방식은 core 에 registerDrill 하고 여기에 화면을 하나 추가한다.
import { DeckRecall } from './deck.tsx'
import { KanaListen, KanaToRomaji, RomajiToKana } from './kana.tsx'
import { KanjiMeaning, KanjiReading, KanjiWordMeaning, KanjiWordReading, KanjiWrite } from './kanji.tsx'
import { ToeicCloze, ToeicMeaning, WordSpell, WordWrite } from './toeic.tsx'
import type { DrillComponent } from './types.ts'

export const DRILL_VIEWS: Record<string, DrillComponent> = {
  'kana-to-romaji': KanaToRomaji,
  'romaji-to-kana': RomajiToKana,
  'kana-listen': KanaListen,
  'kanji-reading': KanjiReading,
  'kanji-meaning': KanjiMeaning,
  'kanji-write': KanjiWrite,
  'kanji-word-meaning': KanjiWordMeaning,
  'kanji-word-reading': KanjiWordReading,
  'toeic-meaning': ToeicMeaning,
  'toeic-cloze': ToeicCloze,
  'word-spell': WordSpell,
  'word-write': WordWrite,
  'deck-recall': DeckRecall,
}

export type { DrillComponent, DrillProps } from './types.ts'
