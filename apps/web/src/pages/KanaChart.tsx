// 가나 50음도 (#/library/kana, 예전 #/kana). 노트의 order 로 자리를 정한다: 줄 = floor(order / 5), 칸 = order % 5.
// 줄 0–10 기본, 11–15 탁음 · 반탁음, 16–26 요음 (packages/core/src/notes.ts KanaFields.order).
// 칸을 누르면 소리를 들려준다.
import { useEffect, useState } from 'react'
import type { KanaFields, KanaScript } from '@nakamura/core'
import { api } from '../api.ts'
import { EmptyState } from '../components/EmptyState.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { speak } from '../speech.ts'

const SECTIONS = [
  { title: '기본', from: 0, to: 10 },
  { title: '탁음 · 반탁음', from: 11, to: 15 },
  { title: '요음', from: 16, to: 26 },
] as const

const TABS: [KanaScript, string][] = [
  ['hiragana', '히라가나'],
  ['katakana', '가타카나'],
]

export function KanaChart() {
  const [notes, setNotes] = useState<KanaFields[] | null>(null)
  const [error, setError] = useState('')
  const [script, setScript] = useState<KanaScript>('hiragana')

  useEffect(() => {
    api<{ notes: { id: string; fields: KanaFields }[] }>('notes?track=kana')
      .then(r => setNotes(r.notes.map(n => n.fields)))
      .catch(err => setError((err as Error).message))
  }, [])

  // order → 글자
  const cells = new Map<number, KanaFields>()
  for (const f of notes ?? []) if (f.script === script && f.order !== undefined) cells.set(f.order, f)

  return (
    <div className="page kana-page">
      <div className="page-tools">
        <a className="back-link" href="#/library">
          ← 자료
        </a>
        <Segmented label="문자" value={script} onChange={setScript} items={TABS.map(([value, label]) => ({ value, label }))} />
      </div>
      <p className="muted small">글자를 누르면 소리를 들려줍니다.</p>
      {error && <p className="error">{error}</p>}
      {notes === null ? (
        !error && <Skeleton height={240} />
      ) : notes.length === 0 ? (
        <EmptyState icon="kana" title="준비 중">
          가나 자료가 아직 없습니다.
        </EmptyState>
      ) : (
        SECTIONS.map(sec => {
          const rows: number[] = []
          for (let r = sec.from; r <= sec.to; r++) if ([0, 1, 2, 3, 4].some(c => cells.has(r * 5 + c))) rows.push(r)
          if (rows.length === 0) return null
          return (
            <section key={sec.title} className="kana-section">
              <h2 className="section-title">{sec.title}</h2>
              <div className="kana-grid" lang="ja">
                {rows.flatMap(r =>
                  [0, 1, 2, 3, 4].map(c => {
                    const f = cells.get(r * 5 + c)
                    return f ? (
                      <button key={r * 5 + c} type="button" className="kana-cell" onClick={() => speak(f.char, 'ja-JP')}>
                        <span className="char">{f.char}</span>
                        <span className="romaji">{f.romaji}</span>
                      </button>
                    ) : (
                      <span key={r * 5 + c} className="kana-cell empty" />
                    )
                  }),
                )}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
