#!/usr/bin/env python3
"""JLPT 한자 원본 데이터 만들기.

KANJIDIC2(읽기 · 획수 · 빈도 · 영어 뜻 · 한국 음)와 커뮤니티 JLPT 목록(davidluzgouveia/kanji-data 의
jlpt_new, Jonathan Waller 목록 기반)을 합쳐서 다음을 쓴다.

  content-src/kanji/base.json          JLPT N 레벨이 있는 한자 전체
  content-src/kanji/batches/nX-YY.json  번역용 묶음(약 100자, 레벨 하나씩), meanings_ko · hunum_ko 는 빈 값

사용 (저장소 루트에서):
  python3 -I tools/kanji/build-base.py            # 받은 파일이 없으면 받는다
  python3 -I tools/kanji/build-base.py --refresh  # 다시 받는다

받은 파일은 tools/kanji/.cache/ 에 둔다(git 제외). 받은 파일은 데이터로만 읽고 실행하지 않는다.
같은 입력이면 출력이 바이트 단위로 같다(정렬된 키, 고정된 순서).

주의: batches/ 를 다시 만들면 같은 이름의 빈 묶음 파일을 덮어쓴다. 번역 결과(*.ko.json)는 건드리지 않는다.
"""
from __future__ import annotations

import gzip
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'tools' / 'kanji' / '.cache'
OUT = ROOT / 'content-src' / 'kanji'

SOURCES = {
    'kanjidic2.xml.gz': 'http://www.edrdg.org/kanjidic/kanjidic2.xml.gz',
    'kanji-data.json': 'https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json',
}

BATCH_SIZE = 100

# korean_h 가 없는 일본 신자체는 정자(구자체)의 한국 음을 빌린다. 빌린 경우는 실행 결과의 특이사항에 나온다.
# (国字는 한국 음이 없는 것이 정상이므로 여기에 넣지 않는다.)
EUM_FROM_VARIANT = {'収': '收'}

# KANJIDIC2 의 korean_h 에 빠진 대표 음 (앞에 덧붙인다). 예: 楽 은 '악' 만 있어 '즐길 락' 을 쓸 수 없다.
# 일본 신자체가 대신하는 정자의 음이 빠진 경우도 여기에: 予(豫 예), 台(臺 대), 缶(罐 관), 担(擔 담), 胆(膽 담).
EUM_EXTRA = {'楽': ['락'], '予': ['예'], '台': ['대'], '缶': ['관'], '担': ['담'], '胆': ['담']}


def fetch(refresh: bool) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        path = CACHE / name
        if path.exists() and not refresh:
            continue
        print(f'받는 중: {url}', file=sys.stderr)
        with urllib.request.urlopen(url, timeout=120) as r:
            data = r.read()
        path.write_bytes(data)


def uniq(xs: list[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    for x in xs:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def load_kanjidic(wanted: set[str]) -> tuple[dict[str, dict], dict[str, str]]:
    """원하는 한자만 읽는다. (항목, 헤더 정보) 를 돌려준다."""
    out: dict[str, dict] = {}
    header: dict[str, str] = {}
    with gzip.open(CACHE / 'kanjidic2.xml.gz') as f:
        for _, el in ET.iterparse(f):
            if el.tag == 'header':
                header = {c.tag: (c.text or '').strip() for c in el}
            if el.tag != 'character':
                continue
            lit = el.findtext('literal')
            if lit in wanted:
                misc = el.find('misc')
                strokes = misc.findall('stroke_count') if misc is not None else []
                freq = misc.findtext('freq') if misc is not None else None
                on: list[str] = []
                kun: list[str] = []
                ko: list[str] = []
                en: list[str] = []
                # nanori(이름 읽기)는 rmgroup 밖이라 자연히 빠진다.
                for rm in el.iter('rmgroup'):
                    for r in rm.findall('reading'):
                        t = (r.text or '').strip()
                        kind = r.get('r_type')
                        if kind == 'ja_on':
                            on.append(t)
                        elif kind == 'ja_kun':
                            kun.append(t)
                        elif kind == 'korean_h':
                            ko.append(t)
                    for m in rm.findall('meaning'):
                        if m.get('m_lang') is None:  # 속성 없음 = 영어
                            en.append((m.text or '').strip())
                out[lit] = {
                    'kanji': lit,
                    'on': uniq(on),
                    'kun': uniq(kun),
                    # 첫 stroke_count 가 정자 획수, 나머지는 흔한 오기
                    'strokes': int(strokes[0].text) if strokes else None,
                    'freq': int(freq) if freq else None,
                    'eum_ko': ', '.join(uniq(ko)),
                    'meanings_en': uniq(en),
                }
            el.clear()
    return out, header


def dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def main() -> None:
    fetch('--refresh' in sys.argv)

    jlpt_src = json.loads((CACHE / 'kanji-data.json').read_text(encoding='utf-8'))
    jlpt = {k: v['jlpt_new'] for k, v in jlpt_src.items() if isinstance(v, dict) and v.get('jlpt_new') in (1, 2, 3, 4, 5)}

    dic, header = load_kanjidic(set(jlpt) | set(EUM_FROM_VARIANT.values()))

    quirks: list[str] = []
    entries = []
    for k, level in jlpt.items():
        d = dic.get(k)
        if d is None:
            quirks.append(f'KANJIDIC2 에 없음 (제외): {k} N{level}')
            continue
        e = {key: val for key, val in d.items() if val is not None}
        e['jlpt'] = level
        if k in EUM_EXTRA:
            have = [x for x in (e.get('eum_ko') or '').split(', ') if x]
            e['eum_ko'] = ', '.join(EUM_EXTRA[k] + [x for x in have if x not in EUM_EXTRA[k]])
            quirks.append(f'음 보충 {EUM_EXTRA[k]}: {k} N{level}')
        if not e['eum_ko'] and k in EUM_FROM_VARIANT:
            v = EUM_FROM_VARIANT[k]
            e['eum_ko'] = dic[v]['eum_ko']
            quirks.append(f'korean_h 없음 → 정자 {v} 의 음 "{e["eum_ko"]}" 사용: {k} N{level}')
        if not e['eum_ko']:
            quirks.append(f'korean_h 없음: {k} N{level}')
        if not e['meanings_en']:
            quirks.append(f'영어 뜻 없음: {k} N{level}')
        if 'strokes' not in e:
            quirks.append(f'획수 없음: {k} N{level}')
        entries.append(e)

    # N5 먼저 → KANJIDIC2 빈도(작을수록 흔함, 없으면 뒤) → 코드포인트
    entries.sort(key=lambda e: (-e['jlpt'], e.get('freq', 10**9), ord(e['kanji'])))
    dump(OUT / 'base.json', entries)

    batch_dir = OUT / 'batches'
    batch_dir.mkdir(parents=True, exist_ok=True)
    # 이전 실행의 빈 묶음 중 이번에 안 만드는 것은 지운다(번역 결과 *.ko.json 은 그대로 둔다).
    names = []
    counts: dict[int, int] = {}
    for level in (5, 4, 3, 2, 1):
        xs = [e for e in entries if e['jlpt'] == level]
        counts[level] = len(xs)
        for i in range(0, len(xs), BATCH_SIZE):
            name = f'n{level}-{i // BATCH_SIZE + 1:02d}'
            names.append(name)
            dump(batch_dir / f'{name}.json', [{**e, 'meanings_ko': [], 'hunum_ko': ''} for e in xs[i : i + BATCH_SIZE]])
    for p in batch_dir.glob('n?-??.json'):
        if p.stem not in names:
            p.unlink()

    print(f"KANJIDIC2 database_version={header.get('database_version')} date_of_creation={header.get('date_of_creation')}")
    print('레벨별 한자 수: ' + ', '.join(f'N{l} {counts[l]}' for l in (5, 4, 3, 2, 1)) + f' (합계 {len(entries)})')
    print(f'묶음 {len(names)}개: ' + ' '.join(names))
    if quirks:
        print(f'데이터 특이사항 {len(quirks)}건:')
        for q in quirks:
            print('  ' + q)


if __name__ == '__main__':
    main()
