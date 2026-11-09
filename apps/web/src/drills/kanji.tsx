// 한자 연습 방식 화면 (콘텐츠가 들어오면 바로 쓸 수 있게 단순하게)
import type { KanjiFields } from '@nakamura/core'
import { TextAnswer } from './inputs.tsx'
import type { DrillProps } from './types.ts'

/** 읽기: 로마자로 치면 히라가나로 바뀐다. 음독 · 훈독 중 하나면 정답. */
export function KanjiReading({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as KanjiFields
  return (
    <>
      <p className="prompt-label muted">읽는 법을 쓰세요 (음독 · 훈독 중 하나)</p>
      <p className="prompt-big" lang="ja">
        {f.kanji}
      </p>
      <TextAnswer answered={result !== null} onSubmit={onSubmit} placeholder="읽기 (예: shoku → しょく)" kana="toHiragana" />
    </>
  )
}

/** 뜻 */
export function KanjiMeaning({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as KanjiFields
  return (
    <>
      <p className="prompt-label muted">뜻을 쓰세요</p>
      <p className="prompt-big" lang="ja">
        {f.kanji}
      </p>
      <TextAnswer answered={result !== null} onSubmit={onSubmit} placeholder="뜻 (한국어)" lang="ko" />
    </>
  )
}
