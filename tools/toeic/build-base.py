#!/usr/bin/env python3
"""토익 단어(TSL) 원본 데이터 만들기.

TOEIC Service List 1.2 (Browne & Culligan, CC BY-SA 4.0) 의 빈도 표와 교육용 표제어 · 변화형 표를 합쳐서 다음을 쓴다.

  content-src/toeic/base.json             TSL 단어 전체, TSL 순위(rank) 순
  content-src/toeic/batches/tsl-YY.json   번역용 묶음(100단어, 순위 순), pos · meaning_ko · example_en · example_ko 는 빈 값

사용 (저장소 루트에서):
  python3 -I tools/toeic/build-base.py            # 받은 파일이 없으면 받는다
  python3 -I tools/toeic/build-base.py --refresh  # 다시 받는다

받은 파일은 tools/toeic/.cache/ 에 둔다(git 제외). 받은 파일은 데이터로만 읽고 실행하지 않는다.
같은 입력이면 출력이 바이트 단위로 같다(정렬된 키, 고정된 순서).

주의: batches/ 를 다시 만들면 같은 이름의 빈 묶음 파일을 덮어쓴다. 번역 결과(*.ko.json)는 건드리지 않는다.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'tools' / 'toeic' / '.cache'
OUT = ROOT / 'content-src' / 'toeic'

# 사이트: https://www.newgeneralservicelist.com/toeic-service-list
SOURCES = {
    # 표제어 · TSL 순위 · SFI · U (순위가 있는 유일한 파일)
    'TSL_12_stats.csv': 'https://www.newgeneralservicelist.com/s/TSL_12_stats.csv',
    # 교육용 표제어 + 흔한 변화형 (번역 참고용 forms)
    'TSL_12_lemmatized_for_teaching.csv': 'https://www.newgeneralservicelist.com/s/TSL_12_lemmatized_for_teaching.csv',
}

BATCH_SIZE = 100

# 단어가 아니라서 뺄 표제어. TSL 1.2 의 1250개는 모두 실제 낱말이라 지금은 비어 있다
# (fax · memo · tech · auto · mini 같은 줄임말도 그 자체로 쓰이는 낱말이라 둔다).
DROP: dict[str, str] = {}

WORD_RE = re.compile(r"^[a-zà-öø-ÿ]+(?:[ '\-][a-zà-öø-ÿ]+)*$")


def fetch(refresh: bool) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCES.items():
        path = CACHE / name
        if path.exists() and not refresh:
            continue
        print(f'받는 중: {url}', file=sys.stderr)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (NakamuraProject data build)'})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        path.write_bytes(data)


def read_text(name: str) -> str:
    raw = (CACHE / name).read_bytes()
    # 사이트의 CSV 는 Windows-1252 (é = 0xE9). UTF-8 로 바뀌어 올 때를 대비해 먼저 UTF-8 을 시도한다.
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = raw.decode('cp1252')
    return text


def num(s: str) -> float | None:
    """SFI · U 값. '#N/A' 이면 None."""
    try:
        return float(s)
    except ValueError:
        return None


def dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def main() -> None:
    fetch('--refresh' in sys.argv)

    rows = list(csv.reader(io.StringIO(read_text('TSL_12_stats.csv'))))
    if rows[0][:2] != ['Word', 'TSL Rank']:
        sys.exit(f'TSL_12_stats.csv 머리줄이 예상과 다름: {rows[0]}')

    forms: dict[str, list[str]] = {}
    for line in read_text('TSL_12_lemmatized_for_teaching.csv').splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        xs = [x.strip() for x in line.split(',') if x.strip()]
        forms[xs[0]] = xs[1:]

    quirks: list[str] = []
    dropped: list[str] = []
    entries = []
    seen: set[str] = set()
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        word, rank = r[0].strip(), int(r[1])
        if word in DROP:
            dropped.append(f'{word} (순위 {rank}): {DROP[word]}')
            continue
        if not WORD_RE.match(word):
            quirks.append(f'낱말 형식이 아님 (제외): {word!r} 순위 {rank}')
            dropped.append(f'{word!r} (순위 {rank}): 낱말 형식이 아님')
            continue
        if word in seen:
            quirks.append(f'중복 표제어 (뒤의 것 제외): {word} 순위 {rank}')
            continue
        seen.add(word)
        e: dict = {'word': word, 'rank': rank, 'list': 'TSL'}
        sfi, u = num(r[2]), num(r[3])
        if sfi is not None:
            e['sfi'] = sfi
        if u is not None:
            e['u'] = u
        if sfi is None or u is None:
            quirks.append(f'SFI · U 값 없음 ({r[2]}, {r[3]}): {word} 순위 {rank}')
        if word in forms:
            if forms[word]:
                e['forms'] = forms[word]
        else:
            quirks.append(f'교육용 표에 표제어 없음 (forms 없음): {word} 순위 {rank}')
        entries.append(e)

    for w in sorted(set(forms) - seen):
        quirks.append(f'교육용 표에만 있는 표제어 (무시): {w}')

    entries.sort(key=lambda e: e['rank'])
    if [e['rank'] for e in entries] != sorted({e['rank'] for e in entries}):
        sys.exit('TSL 순위가 겹친다')
    dump(OUT / 'base.json', entries)

    batch_dir = OUT / 'batches'
    batch_dir.mkdir(parents=True, exist_ok=True)
    names = []
    for i in range(0, len(entries), BATCH_SIZE):
        name = f'tsl-{i // BATCH_SIZE + 1:02d}'
        names.append(name)
        empty = {'pos': '', 'meaning_ko': '', 'example_en': '', 'example_ko': ''}
        dump(batch_dir / f'{name}.json', [{**e, **empty} for e in entries[i : i + BATCH_SIZE]])
    # 이전 실행의 빈 묶음 중 이번에 안 만드는 것은 지운다(번역 결과 *.ko.json 은 그대로 둔다).
    for p in batch_dir.glob('tsl-??.json'):
        if p.stem not in names:
            p.unlink()

    for name in SOURCES:
        print(f'{name} sha256={hashlib.sha256((CACHE / name).read_bytes()).hexdigest()}')
    print(f'TSL 단어 {len(entries)}개 (원본 {len(rows) - 1}줄, 제외 {len(dropped)}개)')
    for d in dropped:
        print('  제외: ' + d)
    print(f'묶음 {len(names)}개: ' + ' '.join(names))
    if quirks:
        print(f'데이터 특이사항 {len(quirks)}건:')
        for q in quirks:
            print('  ' + q)


if __name__ == '__main__':
    main()
