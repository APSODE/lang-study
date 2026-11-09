// 자료 (#/library): 가나 50음도 · 한자 목록으로 가는 타일.
import { Icon, type IconName } from '../components/Icon.tsx'

const TILES: { href: string; icon: IconName; title: string; desc: string; glyph: string }[] = [
  { href: '#/library/kana', icon: 'kana', title: '가나 50음도', desc: '히라가나 · 가타카나 표, 눌러서 소리 듣기', glyph: 'あ' },
  { href: '#/library/kanji', icon: 'kanji', title: '한자 목록', desc: 'JLPT 급수별 한자, 뜻 · 훈음 · 읽기', glyph: '字' },
]

export const KANJI_CREDITS = '한자 데이터: KANJIDIC2 (EDRDG, CC BY-SA 4.0), JLPT 목록: Jonathan Waller (CC BY)'

export function Library() {
  return (
    <div className="page library">
      <ul className="tiles">
        {TILES.map(t => (
          <li key={t.href}>
            <a className="tile card" href={t.href}>
              <span className="tile-glyph" lang="ja" aria-hidden="true">
                {t.glyph}
              </span>
              <span className="tile-text">
                <strong>{t.title}</strong>
                <span className="muted small">{t.desc}</span>
              </span>
              <Icon name="chevron" size={20} />
            </a>
          </li>
        ))}
      </ul>
      <p className="credits small muted">{KANJI_CREDITS}</p>
    </div>
  )
}
