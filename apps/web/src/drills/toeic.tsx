// 토익 연습 방식 화면 (콘텐츠가 들어오면 바로 쓸 수 있게 단순하게)
import { spellMask, type ToeicFields } from '@nakamura/core'
import { speak } from '../speech.ts'
import { ChoiceAnswer, TextAnswer } from './inputs.tsx'
import type { DrillProps } from './types.ts'

/** 뜻: 서버가 보기를 주면 고르기, 아니면 입력 */
export function ToeicMeaning({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as ToeicFields
  return (
    <>
      <p className="prompt-label muted">{item.choices?.length ? '뜻을 고르세요' : '뜻을 쓰세요'}</p>
      <p className="prompt-word" lang="en">
        {f.word}
        {f.pos && <span className="muted small"> {f.pos}</span>}
      </p>
      <p className="prompt-listen">
        <button type="button" className="secondary" onClick={() => speak(f.word, 'en-US')}>
          🔊 듣기
        </button>
      </p>
      {item.choices?.length ? (
        <ChoiceAnswer
          choices={item.choices}
          answered={result !== null}
          picked={result?.response}
          expected={result?.expected}
          onSubmit={onSubmit}
          lang="ko"
        />
      ) : (
        <TextAnswer answered={result !== null} onSubmit={onSubmit} placeholder="뜻 (한국어)" lang="ko" />
      )}
    </>
  )
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 예문 빈칸: 단어(와 그 활용형)를 가린다. 대소문자는 구분하지 않는다. */
export function ToeicCloze({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as ToeicFields
  const blanked = (f.example_en ?? '').replace(new RegExp(`\\b${escapeRe(f.word)}\\w*`, 'gi'), '_____')
  return (
    <>
      <p className="prompt-label muted">빈칸에 들어갈 단어를 쓰세요</p>
      <p className="prompt-sentence" lang="en">
        {blanked}
      </p>
      {f.example_ko && <p className="prompt-hint muted">{f.example_ko}</p>}
      <TextAnswer answered={result !== null} onSubmit={onSubmit} placeholder="단어 (영어)" lang="en" />
    </>
  )
}

/** 철자 채우기: 뜻과 일부를 가린 단어(core spellMask)를 보고 단어 전체를 쓴다. */
export function WordSpell({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as ToeicFields
  return (
    <>
      <p className="prompt-label muted">빈칸을 채워 단어를 완성하세요</p>
      <p className="prompt-hint" lang="ko">
        {f.meaning_ko}
        {f.pos && <span className="muted small"> {f.pos}</span>}
      </p>
      <p className="prompt-spell" lang="en">
        {spellMask(f.word)}
      </p>
      <TextAnswer answered={result !== null} onSubmit={onSubmit} placeholder="단어 전체 (영어)" lang="en" />
    </>
  )
}
