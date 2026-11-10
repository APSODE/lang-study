// 항목(친구가 만든 덱) 연습 방식 화면: 앞면을 보고 뒷면을 쓴다.
// 자동 채점이 틀리면 학습 화면이 모범 답안(뒷면)을 보여 주고 사용자가 스스로 채점한다 (core 의 selfGraded).
import type { DeckFields } from '@nakamura/core'
import { guessLang } from '../study.ts'
import { TextAnswer } from './inputs.tsx'
import type { DrillProps } from './types.ts'

export function DeckRecall({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as DeckFields
  return (
    <>
      <p className="prompt-label muted">답을 쓰세요</p>
      <p className="prompt-word" lang={guessLang(f.front)}>
        {f.front}
      </p>
      <TextAnswer answered={result !== null} onSubmit={onSubmit} placeholder="답" lang={guessLang(f.back)} />
    </>
  )
}
