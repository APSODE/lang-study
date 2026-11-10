// 한자 읽기 · 예시 낱말 · 예문 표시. 자료 → 한자 상세(KanjiList)와 학습 화면의 답 뒤 도움말(Study)이 같이 쓴다.
// 소리는 읽기(가나)로 낸다 — 브라우저 TTS 가 한자를 다른 음으로 읽는 일이 있어서.
import type { ReactNode } from 'react'
import type { KanjiFields } from '@nakamura/core'
import { canSpeak, speak } from '../speech.ts'
import { Icon } from './Icon.tsx'

export type KanjiExample = NonNullable<KanjiFields['examples']>[number]
export type KanjiSentence = NonNullable<KanjiFields['sentences']>[number]

/** 누르면 읽어 주는 알약 모양 읽기. TTS 가 없으면 글자만. */
export function Reading({ text, children }: { text: string; children: ReactNode }) {
  return canSpeak() ? (
    <button type="button" className="reading" onClick={() => speak(text, 'ja-JP')} aria-label={`${text} 듣기`}>
      <span lang="ja">{children}</span>
      <Icon name="speaker" size={16} />
    </button>
  ) : (
    <span className="reading" lang="ja">
      {children}
    </span>
  )
}

/** 예시 낱말: 낱말 · 읽기(누르면 듣기) · 뜻 */
export function ExampleWords({ list }: { list: KanjiExample[] }) {
  return (
    <ul className="examples">
      {list.map(ex => (
        <li key={`${ex.word}|${ex.reading}`}>
          <Reading text={ex.reading}>
            {ex.word} <span className="muted small">{ex.reading}</span>
          </Reading>
          <span className="small">{ex.meaning_ko}</span>
        </li>
      ))}
    </ul>
  )
}

/** 예문: 일본어(크게) · 가나(작게) · 한국어, 오른쪽에 듣기 */
export function ExampleSentences({ list }: { list: KanjiSentence[] }) {
  return (
    <ul className="sentences">
      {list.map(s => (
        <li key={s.ja}>
          <div className="sentence-text">
            <p className="sentence-ja" lang="ja">
              {s.ja}
            </p>
            <p className="muted small" lang="ja">
              {s.kana}
            </p>
            <p className="small">{s.ko}</p>
          </div>
          {canSpeak() && (
            <button type="button" className="icon-btn" onClick={() => speak(s.kana, 'ja-JP')} aria-label="예문 듣기">
              <Icon name="speaker" size={20} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
