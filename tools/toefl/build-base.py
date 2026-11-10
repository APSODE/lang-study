#!/usr/bin/env python3
"""토플 단어(NAWL) 원본 데이터 만들기.

New Academic Word List 1.2 (Browne, Culligan & Phillips, CC BY-SA 4.0) 의 빈도 표와 교육용 표제어 · 변화형 표를 합쳐서 다음을 쓴다.

  content-src/toefl/base.json             NAWL 단어 전체, NAWL 순위(rank) 순
  content-src/toefl/batches/nawl-YY.json  번역용 묶음(약 120단어, 순위 순), pos · meaning_ko · example_en · example_ko 는 빈 값
                                          토익 트랙(content/toeic.json)에 이미 있는 단어는 묶음에서 뺀다(base.json 에는 남김).

사용 (저장소 루트에서):
  python3 -I tools/toefl/build-base.py            # 받은 파일이 없으면 받는다
  python3 -I tools/toefl/build-base.py --refresh  # 다시 받는다

받은 파일은 tools/toefl/.cache/ 에 둔다(git 제외). 받은 파일은 데이터로만 읽고 실행하지 않는다.
같은 입력이면 출력이 바이트 단위로 같다(정렬된 키, 고정된 순서).

주의: batches/ 를 다시 만들면 같은 이름의 빈 묶음 파일을 덮어쓴다. 번역 결과(*.ko.json)는 건드리지 않는다.
토익 단어가 늘면 겹치는 단어가 바뀌어 묶음 구성이 달라질 수 있다. 번역이 시작된 뒤에는 다시 만들지 않는다.
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
CACHE = ROOT / 'tools' / 'toefl' / '.cache'
OUT = ROOT / 'content-src' / 'toefl'
TOEIC = ROOT / 'content' / 'toeic.json'

# 사이트: https://www.newgeneralservicelist.com/new-academic-word-list
SOURCES = {
    # 표제어 · NAWL 순위 · Band · SFI · U (순위가 있는 유일한 파일, 알파벳 순으로 들어 있음)
    'NAWL_12_stats.csv': 'https://www.newgeneralservicelist.com/s/NAWL_12_stats.csv',
    # 교육용 표제어 + 흔한 변화형 (번역 참고용 forms)
    'NAWL_12_lemmatized_for_teaching.csv': 'https://www.newgeneralservicelist.com/s/NAWL_12_lemmatized_for_teaching.csv',
}

BATCH_TARGET = 120

# 교육용 표의 표제어가 빈도 표와 다른 것: 빈도 표 표제어 → 교육용 표 표제어
FORMS_ALIAS = {'headquarters': 'headquarter'}

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
    # 빈도 표는 UTF-8(BOM), 교육용 표는 Windows-1252 로 온다. UTF-8 을 먼저 시도한다.
    try:
        return raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        return raw.decode('cp1252')


def num(s: str) -> float | None:
    try:
        return float(s)
    except ValueError:
        return None


def dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')


def toeic_words() -> set[str]:
    notes = json.loads(TOEIC.read_text(encoding='utf-8'))
    return {n['fields']['word'].strip().lower() for n in notes}


def main() -> None:
    fetch('--refresh' in sys.argv)

    rows = list(csv.reader(io.StringIO(read_text('NAWL_12_stats.csv'))))
    if rows[0][:5] != ['Word', 'Rank', 'Band', 'SFI', 'U']:
        sys.exit(f'NAWL_12_stats.csv 머리줄이 예상과 다름: {rows[0]}')

    forms: dict[str, list[str]] = {}
    for line in read_text('NAWL_12_lemmatized_for_teaching.csv').splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        xs = [x.strip() for x in line.split(',') if x.strip()]
        forms[xs[0]] = xs[1:]

    quirks: list[str] = []
    entries = []
    seen: set[str] = set()
    used_forms: set[str] = set()
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        word, rank = r[0].strip(), int(r[1])
        if not WORD_RE.match(word):
            quirks.append(f'낱말 형식이 아님 (제외): {word!r} 순위 {rank}')
            continue
        if word in seen:
            quirks.append(f'중복 표제어 (뒤의 것 제외): {word} 순위 {rank}')
            continue
        seen.add(word)
        e: dict = {'word': word, 'rank': rank, 'list': 'NAWL'}
        band, sfi, u = num(r[2]), num(r[3]), num(r[4])
        if band is not None:
            e['band'] = int(band)
        if sfi is not None:
            e['sfi'] = sfi
        if u is not None:
            e['u'] = u
        if band is None or sfi is None or u is None:
            quirks.append(f'Band · SFI · U 값 없음 ({r[2]}, {r[3]}, {r[4]}): {word} 순위 {rank}')
        key = word if word in forms else FORMS_ALIAS.get(word)
        if key in forms:
            used_forms.add(key)
            fs = [f for f in forms[key] if f != word]
            if fs:
                e['forms'] = fs
            if key != word:
                quirks.append(f'교육용 표 표제어가 다름: {word} ← {key} 의 변화형을 씀')
        else:
            quirks.append(f'교육용 표에 표제어 없음 (forms 없음): {word} 순위 {rank}')
        entries.append(e)

    for w in sorted(set(forms) - used_forms):
        quirks.append(f'교육용 표에만 있는 표제어 (순위가 없어 뺌): {w}')

    entries.sort(key=lambda e: e['rank'])
    if [e['rank'] for e in entries] != sorted({e['rank'] for e in entries}):
        sys.exit('NAWL 순위가 겹친다')
    dump(OUT / 'base.json', entries)

    toeic = toeic_words()
    # 표제어가 같거나, 교육용 표 표제어(FORMS_ALIAS)가 토익 단어와 같으면 겹친다고 본다 (headquarters ↔ headquarter).
    def dup(e: dict) -> bool:
        w = e['word'].lower()
        return w in toeic or FORMS_ALIAS.get(w, w) in toeic

    overlap = [e for e in entries if dup(e)]
    todo = [e for e in entries if not dup(e)]

    n_batches = max(1, round(len(todo) / BATCH_TARGET))
    size, extra = divmod(len(todo), n_batches)
    batch_dir = OUT / 'batches'
    batch_dir.mkdir(parents=True, exist_ok=True)
    names = []
    start = 0
    empty = {'pos': '', 'meaning_ko': '', 'example_en': '', 'example_ko': ''}
    for b in range(n_batches):
        n = size + (1 if b < extra else 0)
        name = f'nawl-{b + 1:02d}'
        names.append(f'{name} ({n})')
        dump(batch_dir / f'{name}.json', [{**e, **empty} for e in todo[start : start + n]])
        start += n
    stems = {x.split()[0] for x in names}
    for p in batch_dir.glob('nawl-??.json'):
        if p.stem not in stems:
            p.unlink()

    for name in SOURCES:
        print(f'{name} sha256={hashlib.sha256((CACHE / name).read_bytes()).hexdigest()}')
    print(f'NAWL 단어 {len(entries)}개 (원본 {len(rows) - 1}줄)')
    print(f'토익과 겹쳐 묶음에서 뺀 단어 {len(overlap)}개: ' + ', '.join(f"{e['word']}({e['rank']})" for e in overlap))
    print(f'묶음 {n_batches}개, 단어 {len(todo)}개: ' + ' '.join(names))
    if quirks:
        print(f'데이터 특이사항 {len(quirks)}건:')
        for q in quirks:
            print('  ' + q)


if __name__ == '__main__':
    main()
