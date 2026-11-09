// 연습 방식들이 같이 쓰는 입력: 글자 입력(TextAnswer) · 보기 고르기(ChoiceAnswer)
import { type FormEvent, useEffect, useRef } from 'react'
import { bind, toHiragana, toKatakana, unbind } from 'wanakana'

export type KanaMode = 'toHiragana' | 'toKatakana'

interface TextAnswerProps {
  answered: boolean
  onSubmit: (response: string) => void
  placeholder: string
  /** 로마자 → 가나 변환 (wanakana). 가나 IME 로 직접 입력해도 그대로 받는다. */
  kana?: KanaMode
  /** 영어 · 로마자 입력이면 'en', 한국어 뜻이면 'ko' */
  lang?: string
}

/**
 * 한 줄 입력 + 확인. wanakana 가 값을 직접 바꾸므로 React 가 값을 들고 있지 않는다(비제어 입력).
 * 카드가 바뀌면 학습 화면이 key 로 새로 만든다.
 */
export function TextAnswer({ answered, onSubmit, placeholder, kana, lang }: TextAnswerProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !kana) return
    bind(el, { IMEMode: kana })
    return () => unbind(el)
  }, [kana])

  useEffect(() => {
    if (!answered) ref.current?.focus()
  }, [answered])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (answered || !ref.current) return
    let v = ref.current.value
    // 끝에 남은 로마자(예: 마지막 n)를 마저 바꾼다. 이미 가나인 부분은 건드리지 않는다.
    if (kana) v = v.replace(/[a-z']+/gi, m => (kana === 'toKatakana' ? toKatakana(m.toLowerCase()) : toHiragana(m.toLowerCase())))
    if (v.trim() === '') return
    ref.current.value = v
    onSubmit(v)
  }

  return (
    <form className="answer-form" onSubmit={submit}>
      <input
        ref={ref}
        className="answer-input"
        placeholder={placeholder}
        lang={kana ? 'ja' : lang}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="done"
        readOnly={answered}
        aria-label={placeholder}
      />
      {!answered && <button type="submit">확인</button>}
    </form>
  )
}

interface ChoiceAnswerProps {
  choices: string[]
  answered: boolean
  /** 답한 뒤: 고른 것과 정답을 표시 */
  picked?: string
  expected?: string
  onSubmit: (response: string) => void
  lang?: string
}

/** 보기 고르기. 숫자 키 1–4 로도 고른다 (입력칸 · 대화상자에 있을 때는 무시). */
export function ChoiceAnswer({ choices, answered, picked, expected, onSubmit, lang }: ChoiceAnswerProps) {
  useEffect(() => {
    if (answered) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select') || t.closest('dialog'))) return
      if (document.querySelector('dialog[open]')) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
        e.preventDefault()
        onSubmit(choices[n - 1]!)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answered, choices, onSubmit])

  return (
    <div className="choices" lang={lang}>
      {choices.map((c, i) => {
        const cls = answered ? (c === expected ? 'right' : c === picked ? 'wrong' : '') : ''
        return (
          <button key={c} type="button" className={cls} disabled={answered} onClick={() => onSubmit(c)}>
            <span className="key">{i + 1}</span>
            <span className="label">{c}</span>
          </button>
        )
      })}
    </div>
  )
}
