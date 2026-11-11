// 토익 연습 방식 화면 (콘텐츠가 들어오면 바로 쓸 수 있게 단순하게)
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
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

/** 문장 속 표제어(와 그 활용형)를 <mark> 로 강조한다. 대소문자는 구분하지 않는다. */
export function HighlightWord({ text, word }: { text: string; word: string }) {
  if (!word) return <>{text}</>
  const re = new RegExp(`\\b${escapeRe(word)}\\w*`, 'gi')
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <mark key={m.index} className="headword">
        {m[0]}
      </mark>,
    )
    last = m.index + m[0].length
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}

/**
 * 영작: 예문의 한국어 → 영어. Enter = 확인, Shift+Enter = 줄바꿈.
 * 자동 채점이 틀리면 학습 화면이 모범 답안(표제어 강조)을 보여 주고 사용자가 스스로 채점한다 (core 의 selfGraded).
 */
export function WordWrite({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as ToeicFields
  const ref = useRef<HTMLTextAreaElement>(null)
  const answered = result !== null

  useEffect(() => {
    if (!answered) ref.current?.focus()
  }, [answered])

  const submit = () => {
    if (answered || !ref.current) return
    const v = ref.current.value
    if (v.trim() === '') return
    onSubmit(v)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    submit()
  }

  if (!f.example_ko) return <p className="muted">예문이 없는 카드입니다.</p>

  return (
    <>
      <p className="prompt-label muted">영어로 쓰세요</p>
      <p className="prompt-ko" lang="ko">
        {f.example_ko}
      </p>
      <p className="prompt-hint muted">
        <span className="write-kanji" lang="en">
          {f.word}
        </span>{' '}
        {f.meaning_ko}
      </p>
      <form
        className="write-form"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          ref={ref}
          className="write-input"
          rows={2}
          lang="en"
          placeholder="영어 문장"
          aria-label="영어 문장"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          enterKeyHint="done"
          readOnly={answered}
          onKeyDown={onKeyDown}
        />
        {!answered && (
          <div className="write-tools">
            <span />
            <button type="submit">확인</button>
          </div>
        )}
      </form>
    </>
  )
}
