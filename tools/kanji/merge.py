#!/usr/bin/env python3
"""번역된 한자 묶음(*.ko.json)을 검사하고 kanji 노트로 합친다.

  python3 -I tools/kanji/merge.py                  # content-src/kanji/batches → content-src/kanji/merged.json
  python3 -I tools/kanji/merge.py --dir <폴더> --out <파일>

묶음마다 문제를 출력한다.
  오류(ERROR) — 그 한자는 merged.json 에 넣지 않는다.
  경고(WARN)  — 넣기는 하지만 사람이 한 번 봐야 한다.
오류가 하나라도 있으면 종료 코드 1. content/ 에는 쓰지 않는다(어디로 옮길지는 사람이 정한다).

검사 내용
  - 입력 묶음과 한자 집합 · 순서가 같은가
  - meanings_ko · hunum_ko 말고 다른 필드가 바뀌지 않았는가, 키가 늘거나 줄지 않았는가
  - meanings_ko: 비어 있지 않은 한글 문자열 1–4개, 중복 없음
  - hunum_ko: "" 이거나 "<훈> <음>" 형식이고, 마지막 낱말(음)이 eum_ko 의 음 중 하나
  - 国字(meanings_en 에 "(kokuji)")인데 hunum_ko 를 채웠으면 경고, eum_ko 가 있는데 hunum_ko 가 비었으면 경고
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = ROOT / 'content-src' / 'kanji' / 'batches'
DEFAULT_OUT = ROOT / 'content-src' / 'kanji' / 'merged.json'

TRANSLATED = ('meanings_ko', 'hunum_ko')
HUNUM_RE = re.compile(r'^[가-힣]+( [가-힣]+)* [가-힣]$')  # packages/core/src/validate.ts 와 같은 규칙
HANGUL_RE = re.compile(r'[가-힣]')
BATCH_RE = re.compile(r'^n[1-5]-\d{2}$')


def arg(name: str, default: Path) -> Path:
    if name in sys.argv:
        return Path(sys.argv[sys.argv.index(name) + 1]).resolve()
    return default


def check_entry(src: dict, ko: dict) -> tuple[list[str], list[str]]:
    errs: list[str] = []
    warns: list[str] = []
    if set(ko) != set(src):
        extra = sorted(set(ko) - set(src))
        missing = sorted(set(src) - set(ko))
        if extra:
            errs.append(f'모르는 키 {extra}')
        if missing:
            errs.append(f'빠진 키 {missing}')
    for k, v in src.items():
        if k not in TRANSLATED and k in ko and ko[k] != v:
            errs.append(f'{k} 가 바뀜 (원래 {json.dumps(v, ensure_ascii=False)})')

    m = ko.get('meanings_ko')
    if not isinstance(m, list) or not m:
        errs.append('meanings_ko 가 비었음')
    elif not all(isinstance(x, str) and x.strip() == x and x and HANGUL_RE.search(x) for x in m):
        errs.append(f'meanings_ko 에 빈 값 · 앞뒤 공백 · 한글 없는 값이 있음: {m}')
    else:
        if len(m) > 4:
            errs.append(f'meanings_ko 가 {len(m)}개 (1–4개)')
        if len(set(m)) != len(m):
            errs.append(f'meanings_ko 중복: {m}')

    h = ko.get('hunum_ko')
    eums = [x for x in str(src.get('eum_ko', '')).split(', ') if x]
    kokuji = '(kokuji)' in src.get('meanings_en', [])
    if not isinstance(h, str):
        errs.append('hunum_ko 가 문자열이 아님')
    elif h:
        if not HUNUM_RE.match(h):
            errs.append(f'hunum_ko 형식이 틀림 ("<훈> <음>"): {h!r}')
        elif not eums:
            errs.append(f'eum_ko 가 비어 있어 음을 확인할 수 없음: {h!r}')
        elif h.split(' ')[-1] not in eums:
            errs.append(f'hunum_ko 의 음 "{h.split(" ")[-1]}" 이 eum_ko({src["eum_ko"]}) 에 없음')
        if kokuji:
            warns.append(f'国字인데 hunum_ko 가 있음: {h!r}')
    elif eums and not kokuji:
        warns.append(f'hunum_ko 가 비었음 (eum_ko {src["eum_ko"]})')
    return errs, warns


def to_note(e: dict) -> dict:
    f = {
        'kanji': e['kanji'],
        'on': e['on'],
        'kun': e['kun'],
        'meanings_ko': e['meanings_ko'],
        'jlpt': e['jlpt'],
        'meanings_en': e['meanings_en'],
    }
    if 'strokes' in e:
        f['strokes'] = e['strokes']
    if e.get('eum_ko'):
        f['eum_ko'] = e['eum_ko']
    if e.get('hunum_ko'):
        f['hunum_ko'] = e['hunum_ko']
    if not f['meanings_en']:
        del f['meanings_en']
    return {'id': f"kanji-{e['kanji']}", 'track': 'kanji', 'fields': f}


def main() -> int:
    batch_dir = arg('--dir', DEFAULT_DIR)
    out = arg('--out', DEFAULT_OUT)

    inputs = sorted(p for p in batch_dir.glob('*.json') if BATCH_RE.match(p.stem))
    level_order = {f'n{l}': i for i, l in enumerate((5, 4, 3, 2, 1))}
    inputs.sort(key=lambda p: (level_order[p.stem[:2]], p.stem))
    stray = sorted(p.name for p in batch_dir.glob('*.ko.json') if not BATCH_RE.match(p.name[: -len('.ko.json')]))

    notes: list[dict] = []
    total_err = total_warn = done = 0
    missing: list[str] = []
    for p in inputs:
        src = json.loads(p.read_text(encoding='utf-8'))
        kp = p.with_name(p.stem + '.ko.json')
        if not kp.exists():
            missing.append(p.stem)
            continue
        problems: list[str] = []
        try:
            ko = json.loads(kp.read_text(encoding='utf-8'))
        except json.JSONDecodeError as e:
            print(f'[{p.stem}] ERROR JSON 을 읽을 수 없음: {e}')
            total_err += 1
            continue
        if not isinstance(ko, list) or not all(isinstance(x, dict) for x in ko):
            print(f'[{p.stem}] ERROR 객체 배열이 아님')
            total_err += 1
            continue

        src_chars = [e['kanji'] for e in src]
        ko_chars = [e.get('kanji') for e in ko]
        if set(src_chars) != set(ko_chars) or len(ko_chars) != len(src_chars):
            lost = [c for c in src_chars if c not in ko_chars]
            added = [c for c in ko_chars if c not in src_chars]
            dup = sorted({c for c in ko_chars if ko_chars.count(c) > 1}, key=str)
            problems.append(f'ERROR 한자 집합이 다름 — 빠짐 {"".join(lost) or "-"}, 추가 {added or "-"}, 중복 {dup or "-"}')
        elif ko_chars != src_chars:
            problems.append('WARN 순서가 입력과 다름 (입력 순서로 합침)')

        by_char = {e.get('kanji'): e for e in ko}
        n_err = n_warn = 0
        for s in src:
            k = by_char.get(s['kanji'])
            if k is None:
                continue
            errs, warns = check_entry(s, k)
            for x in errs:
                problems.append(f'ERROR {s["kanji"]}: {x}')
            for x in warns:
                problems.append(f'WARN  {s["kanji"]}: {x}')
            n_err += len(errs)
            n_warn += len(warns)
            if not errs:
                notes.append(to_note({**s, 'meanings_ko': k['meanings_ko'], 'hunum_ko': k['hunum_ko']}))
        n_err += sum(1 for x in problems if x.startswith('ERROR 한자'))
        n_warn += sum(1 for x in problems if x.startswith('WARN 순서'))
        total_err += n_err
        total_warn += n_warn
        done += 1
        print(f'[{p.stem}] {len(src)}자 — 오류 {n_err}, 경고 {n_warn}')
        for x in problems:
            print('    ' + x)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(notes, ensure_ascii=False, indent=2, sort_keys=True) + '\n', encoding='utf-8')

    print()
    print(f'묶음 {len(inputs)}개 중 번역 {done}개, 합친 노트 {len(notes)}개 → {out}')
    if missing:
        print(f'번역 없음 ({len(missing)}): {" ".join(missing)}')
    if stray:
        print(f'입력 묶음과 짝이 없는 파일: {" ".join(stray)}')
    print(f'오류 {total_err}, 경고 {total_warn}')
    return 1 if total_err else 0


if __name__ == '__main__':
    sys.exit(main())
