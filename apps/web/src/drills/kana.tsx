// 가나 연습 방식 화면
import { useEffect } from 'react'
import type { KanaFields } from '@nakamura/core'
import { speak } from '../speech.ts'
import { ChoiceAnswer, TextAnswer } from './inputs.tsx'
import type { DrillProps } from './types.ts'

const SCRIPT_LABEL = { hiragana: '히라가나', katakana: '가타카나' } as const

/** 글자 → 로마자 */
export function KanaToRomaji({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as KanaFields
  return (
    <>
      <p className="prompt-label muted">{SCRIPT_LABEL[f.script]} · 로마자로 쓰세요</p>
      <p className="prompt-big" lang="ja">
        {f.char}
      </p>
      <TextAnswer answered={result !== null} onSubmit={onSubmit} placeholder="로마자 (예: ka)" lang="en" />
    </>
  )
}

/** 로마자 → 글자. 로마자로 치면 wanakana 가 가나로 바꾼다. */
export function RomajiToKana({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as KanaFields
  return (
    <>
      <p className="prompt-label muted">{SCRIPT_LABEL[f.script]}로 쓰세요</p>
      <p className="prompt-big" lang="en">
        {f.romaji}
      </p>
      {f.hint && <p className="prompt-hint muted">{f.hint}</p>}
      <TextAnswer
        answered={result !== null}
        onSubmit={onSubmit}
        placeholder={f.script === 'katakana' ? '가타카나' : '히라가나'}
        kana={f.script === 'katakana' ? 'toKatakana' : 'toHiragana'}
      />
    </>
  )
}

/** 듣고 고르기 */
export function KanaListen({ item, result, onSubmit }: DrillProps) {
  const f = item.fields as KanaFields
  useEffect(() => speak(f.char, 'ja-JP'), [f.char])
  return (
    <>
      <p className="prompt-label muted">{SCRIPT_LABEL[f.script]} · 듣고 고르세요</p>
      <p className="prompt-listen">
        <button type="button" className="secondary big" onClick={() => speak(f.char, 'ja-JP')}>
          🔊 다시 듣기
        </button>
      </p>
      <ChoiceAnswer
        choices={item.choices ?? []}
        answered={result !== null}
        picked={result?.response}
        expected={result?.expected}
        onSubmit={onSubmit}
        lang="ja"
      />
    </>
  )
}
