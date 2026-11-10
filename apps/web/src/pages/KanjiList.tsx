// 한자 목록 (#/library/kanji): JLPT 급수별(N5 → N1) 묶음, 검색, 누르면 자세히 보기 시트.
// 검색은 한자 · 한국어 뜻 · 훈음 · 읽기(가나 또는 로마자)로 한다.
import { useDeferredValue, useMemo, useState } from 'react'
import type { KanjiFields } from '@nakamura/core'
import { toHiragana } from 'wanakana'
import { EmptyState, LoadError } from '../components/EmptyState.tsx'
import { Icon } from '../components/Icon.tsx'
import { ExampleSentences, ExampleWords, Reading } from '../components/KanjiExamples.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { Skeleton } from '../components/Skeleton.tsx'
import { fmtNum } from '../format.ts'
import { useApi } from '../hooks.ts'
import type { NotesResponse } from '../types.ts'
import { KANJI_CREDITS } from './Library.tsx'

type Level = 'all' | '5' | '4' | '3' | '2' | '1'
const LEVELS: Level[] = ['all', '5', '4', '3', '2', '1']
/** 0 = 급수 정보 없음 */
const GROUPS = [5, 4, 3, 2, 1, 0] as const

interface Item {
  id: string
  f: KanjiFields
  /** 검색용으로 미리 이어 둔 글 (소문자 · 히라가나) */
  hay: string
}

/** KANJIDIC2 표기 'ひと.つ' · '-び' → 소리 낼 텍스트 'ひとつ' · 'び' */
const plain = (reading: string) => reading.replace(/[.\-]/g, '')

const toItem = (id: string, f: KanjiFields): Item => ({
  id,
  f,
  hay: [
    f.kanji,
    f.hunum_ko ?? '',
    f.eum_ko ?? '',
    ...(f.meanings_ko ?? []),
    ...(f.on ?? []).map(r => toHiragana(r)),
    ...(f.kun ?? []).map(plain),
  ]
    .join('\u0000')
    .toLowerCase(),
})

const matcher = (q: string): ((it: Item) => boolean) | null => {
  const t = q.trim().toLowerCase()
  if (!t) return null
  // 로마자로 치면 히라가나로도 찾는다 (shoku → しょく). 가타카나도 히라가나로 맞춘다.
  const kana = /[a-z]/.test(t) ? toHiragana(t) : toHiragana(t, { passRomaji: true })
  return it => it.hay.includes(t) || (kana !== t && it.hay.includes(kana))
}

/** 훈독 표시: 'た.べる' → た + (べる 흐리게) */
function Kun({ r }: { r: string }) {
  const [stem, okuri] = r.replace(/-/g, '').split('.')
  return (
    <>
      {stem}
      {okuri && <span className="okuri">{okuri}</span>}
    </>
  )
}

function KanjiDetail({ f, onClose }: { f: KanjiFields; onClose: () => void }) {
  return (
    <Sheet title={`${f.kanji} 자세히`} onClose={onClose}>
      <div className="kanji-detail">
        <div className="kd-top">
          <span className="kd-char" lang="ja">
            {f.kanji}
          </span>
          <div className="kd-meta">
            {f.hunum_ko && <p className="kd-hunum">{f.hunum_ko}</p>}
            <p className="muted small">
              {[f.jlpt ? `N${f.jlpt}` : null, f.strokes ? `${f.strokes}획` : null, f.eum_ko ? `음 ${f.eum_ko}` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        {(f.meanings_ko?.length ?? 0) > 0 && (
          <section>
            <h3>뜻</h3>
            <p>{f.meanings_ko!.join(', ')}</p>
          </section>
        )}
        {(f.on?.length ?? 0) > 0 && (
          <section>
            <h3>음독</h3>
            <div className="readings">
              {f.on!.map(r => (
                <Reading key={r} text={plain(r)}>
                  {r}
                </Reading>
              ))}
            </div>
          </section>
        )}
        {(f.kun?.length ?? 0) > 0 && (
          <section>
            <h3>훈독</h3>
            <div className="readings">
              {f.kun!.map(r => (
                <Reading key={r} text={plain(r)}>
                  <Kun r={r} />
                </Reading>
              ))}
            </div>
          </section>
        )}
        {f.examples && f.examples.length > 0 && (
          <section>
            <h3>예시 낱말</h3>
            <ExampleWords list={f.examples} />
          </section>
        )}
        {f.sentences && f.sentences.length > 0 && (
          <section>
            <h3>예문</h3>
            <ExampleSentences list={f.sentences} />
          </section>
        )}
      </div>
    </Sheet>
  )
}

export function KanjiList() {
  const notes = useApi<NotesResponse<'kanji'>>('notes?track=kanji')
  const [level, setLevel] = useState<Level>('all')
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query)
  const [open, setOpen] = useState<KanjiFields | null>(null)

  const items = useMemo(() => (notes.data?.notes ?? []).map(n => toItem(n.id, n.fields)), [notes.data])
  const counts = useMemo(() => {
    const c = new Map<number, number>()
    for (const it of items) c.set(it.f.jlpt ?? 0, (c.get(it.f.jlpt ?? 0) ?? 0) + 1)
    return c
  }, [items])

  const groups = useMemo(() => {
    const match = matcher(q)
    return GROUPS.filter(g => level === 'all' || String(g) === level).map(g => ({
      g,
      list: items.filter(it => (it.f.jlpt ?? 0) === g && (!match || match(it))),
    }))
  }, [items, level, q])
  const shown = groups.reduce((n, x) => n + x.list.length, 0)

  return (
    <div className="page kanji-page">
      <div className="page-tools">
        <a className="back-link" href="#/library">
          ← 자료
        </a>
      </div>

      {notes.data && items.length === 0 ? (
        <EmptyState icon="kanji" title="준비 중">
          한자 자료가 아직 없습니다.
        </EmptyState>
      ) : notes.data ? (
        <>
          <label className="search">
            <Icon name="search" size={20} />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="한자 · 뜻 · 읽기 (예: 먹다, しょく, shoku)"
              aria-label="한자 검색"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <Segmented
            label="JLPT 급수"
            value={level}
            onChange={setLevel}
            items={LEVELS.map(l => ({
              value: l,
              label: l === 'all' ? `전체 ${fmtNum(items.length)}` : `N${l}`,
            }))}
          />

          {shown === 0 && <p className="muted">찾는 한자가 없습니다.</p>}
          {groups.map(({ g, list }) =>
            list.length === 0 ? null : (
              <section key={g} className="kanji-group">
                <h2 className="section-title">
                  {g === 0 ? '급외' : `N${g}`}
                  <span className="muted small">
                    {list.length === (counts.get(g) ?? 0) ? `${fmtNum(list.length)}자` : `${fmtNum(list.length)} / ${fmtNum(counts.get(g) ?? 0)}자`}
                  </span>
                </h2>
                <div className="kanji-grid" lang="ja">
                  {list.map(it => (
                    <button
                      key={it.id}
                      type="button"
                      className="kanji-cell"
                      onClick={() => setOpen(it.f)}
                      aria-label={`${it.f.kanji} ${it.f.hunum_ko ?? it.f.meanings_ko?.[0] ?? ''}`}
                    >
                      <span className="kc-char">{it.f.kanji}</span>
                      {it.f.hunum_ko && (
                        <span className="kc-sub" lang="ko">
                          {it.f.hunum_ko}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ),
          )}
        </>
      ) : notes.error ? (
        <LoadError error={notes.error} notReady={notes.notReady} onRetry={notes.reload} />
      ) : (
        <Skeleton height={240} />
      )}

      <p className="credits small muted">{KANJI_CREDITS}</p>
      {open && <KanjiDetail f={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
