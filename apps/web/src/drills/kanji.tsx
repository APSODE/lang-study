// 한자 연습 방식 화면 (콘텐츠가 들어오면 바로 쓸 수 있게 단순하게)
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { KanjiFields } from '@nakamura/core'
import { bind, toHiragana, unbind } from 'wanakana'
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

/**
 * 일작: 예문의 한국어 → 일본어. 일본어 IME 로 치는 것이 기본이라 wanakana 를 붙이지 않고,
 * "로마자 입력" 을 켜면 그때만 로마자 → 히라가나로 바꾼다. Enter = 확인 (IME 변환 중의 Enter 는 제외), Shift+Enter = 줄바꿈.
 * 자동 채점이 틀리면 학습 화면이 모범 답안을 보여 주고 사용자가 스스로 채점한다 (core 의 selfGraded).
 */
export function KanjiWrite({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as KanjiFields
  const s = f.sentences?.[0]
  const ref = useRef<HTMLTextAreaElement>(null)
  const [romaji, setRomaji] = useState(false)
  const answered = result !== null

  useEffect(() => {
    const el = ref.current
    if (!el || !romaji) return
    bind(el, { IMEMode: 'toHiragana' })
    return () => unbind(el)
  }, [romaji])

  useEffect(() => {
    if (!answered) ref.current?.focus()
  }, [answered, romaji])

  const submit = () => {
    if (answered || !ref.current) return
    let v = ref.current.value
    // 로마자 입력이면 끝에 남은 로마자(예: 마지막 n)를 마저 바꾼다
    if (romaji) v = v.replace(/[a-z']+/gi, m => toHiragana(m.toLowerCase()))
    if (v.trim() === '') return
    ref.current.value = v
    onSubmit(v)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing · keyCode 229 = IME 변환 중 (사파리는 keyCode 로만 알 수 있다)
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    submit()
  }

  if (!s) return <p className="muted">예문이 없는 카드입니다.</p>

  return (
    <>
      <p className="prompt-label muted">일본어로 쓰세요</p>
      <p className="prompt-ko" lang="ko">
        {s.ko}
      </p>
      <p className="prompt-hint muted">
        <span className="write-kanji" lang="ja">
          {f.kanji}
        </span>{' '}
        {f.hunum_ko ?? f.meanings_ko[0]}
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
          lang="ja"
          placeholder={romaji ? '로마자로 (예: tomodachi → ともだち)' : '일본어 문장'}
          aria-label="일본어 문장"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          readOnly={answered}
          onKeyDown={onKeyDown}
        />
        <div className="write-tools">
          <label className="check-inline small">
            <input type="checkbox" checked={romaji} disabled={answered} onChange={e => setRomaji(e.target.checked)} />
            로마자 입력
          </label>
          {!answered && <button type="submit">확인</button>}
        </div>
      </form>
    </>
  )
}
