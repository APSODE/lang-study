// 친구가 만든 문제의 필드 미리보기 (문제 만들기 · 관리 검토 대기가 같이 쓴다). 한자 · 토익만.
import type { Track } from '@nakamura/core'

const list = (v: unknown, sep: string): string => (Array.isArray(v) ? v.join(sep) : typeof v === 'string' ? v : '')

/** 노트의 대표 글자: 가나 char · 한자 kanji · 토익 word */
export const noteMain = (fields: Record<string, unknown>): string => {
  const v = fields.char ?? fields.kanji ?? fields.word
  return typeof v === 'string' ? v : ''
}

export function NotePreview({ track, fields }: { track: Track; fields: Record<string, unknown> }) {
  const rows: [string, string, string?][] =
    track === 'kanji'
      ? [
          ['음독', list(fields.on, '、'), 'ja'],
          ['훈독', list(fields.kun, '、'), 'ja'],
          ['뜻', list(fields.meanings_ko, ', ')],
          ['훈음', list(fields.hunum_ko, '')],
          ['JLPT', typeof fields.jlpt === 'number' ? `N${fields.jlpt}` : ''],
        ]
      : [
          ['품사', list(fields.pos, '')],
          ['뜻', list(fields.meaning_ko, '')],
          ['예문', list(fields.example_en, ''), 'en'],
          ['해석', list(fields.example_ko, '')],
        ]
  return (
    <dl className="note-preview">
      {rows
        .filter(([, v]) => v !== '')
        .map(([k, v, lang]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd lang={lang}>{v}</dd>
          </div>
        ))}
    </dl>
  )
}
