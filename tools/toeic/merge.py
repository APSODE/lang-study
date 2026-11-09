#!/usr/bin/env python3
"""번역된 토익 묶음(*.ko.json)을 검사하고 toeic 노트로 합친다.

  python3 -I tools/toeic/merge.py                  # content-src/toeic/batches → content-src/toeic/merged.json
  python3 -I tools/toeic/merge.py --dir <폴더> --out <파일>

묶음마다 문제를 출력한다.
  오류(ERROR) — 그 단어는 merged.json 에 넣지 않는다.
  경고(WARN)  — 넣기는 하지만 사람이 한 번 봐야 한다.
오류가 하나라도 있으면 종료 코드 1. content/ 에는 쓰지 않는다(어디로 옮길지는 사람이 정한다).

검사 내용
  - 입력 묶음과 단어 집합 · 순서가 같은가
  - pos · meaning_ko · example_en · example_ko 말고 다른 필드가 바뀌지 않았는가, 키가 늘거나 줄지 않았는가
  - 네 필드 모두 비어 있지 않은 문자열, 앞뒤 공백 없음
  - pos: n v adj adv prep conj pron det num 중 하나, 또는 ", " 로 이은 서로 다른 것 2–3개
  - meaning_ko: ", " 로 나눈 1–3개, 각 항목에 한글, 중복 없음, 채점기(splitMeanings)가 쪼개는 ; · / 금지
  - example_en: 표제어를 철자 그대로(대소문자 무시) 온전한 낱말로 포함 (빈칸 문제용), 한글 없음
    · 웹 빈칸 처리(apps/web/src/drills/toeic.tsx: /\\b<word>\\w*/gi)가 다른 낱말까지 가리면 경고 (예: pan → panel)
    · 8–18 낱말이 아니거나 . ? ! 로 끝나지 않으면 경고
  - example_ko: 한글 포함
  - 노트 id(toeic-<이름>)가 core 의 NOTE_ID_RE 에 맞고 서로 겹치지 않는가
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = ROOT / 'content-src' / 'toeic' / 'batches'
DEFAULT_OUT = ROOT / 'content-src' / 'toeic' / 'merged.json'

TRANSLATED = ('pos', 'meaning_ko', 'example_en', 'example_ko')
POS = ('n', 'v', 'adj', 'adv', 'prep', 'conj', 'pron', 'det', 'num')
HANGUL_RE = re.compile(r'[가-힣]')
LATIN_RE = re.compile(r'[A-Za-z]')
NOTE_ID_RE = re.compile(r'^([a-z]+)-[^\s:]+$')  # packages/core/src/validate.ts 와 같은 규칙
BATCH_RE = re.compile(r'^tsl-\d{2}$')
# 채점기 splitMeanings(packages/core/src/text.ts)가 나누는 문자. 쉼표는 구분자로만 쓴다.
SPLIT_CHARS_RE = re.compile(r'[;·/]')
# 낱말을 이루는 글자 (영문 · 악센트 문자 · 숫자 · 밑줄)
WORDCH = r"0-9A-Za-z_À-ÖØ-öø-ÿ"


def arg(name: str, default: Path) -> Path:
    if name in sys.argv:
        return Path(sys.argv[sys.argv.index(name) + 1]).resolve()
    return default


def note_id(word: str) -> str:
    """toeic-<이름>. 공백은 '-' 로, 아포스트로피는 뺀다 (ice cream → toeic-ice-cream, o'clock → toeic-oclock).
    악센트는 그대로 둔다 (résumé 와 resume 이 둘 다 목록에 있다)."""
    name = re.sub(r'\s+', '-', word.strip().lower()).replace("'", '').replace('’', '')
    return f'toeic-{name}'


def whole_word_re(word: str) -> re.Pattern:
    return re.compile(rf'(?<![{WORDCH}]){re.escape(word)}(?![{WORDCH}])', re.IGNORECASE)


def web_blank_re(word: str) -> re.Pattern:
    # apps/web/src/drills/toeic.tsx 의 new RegExp(`\\b${word}\\w*`, 'gi') 를 흉내 낸다 (JS 의 \b · \w 는 ASCII 기준).
    return re.compile(rf'(?<![0-9A-Za-z_]){re.escape(word)}[0-9A-Za-z_]*', re.IGNORECASE | re.ASCII)


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

    for k in TRANSLATED:
        v = ko.get(k)
        if not isinstance(v, str) or not v.strip():
            errs.append(f'{k} 가 비었음')
        elif v.strip() != v:
            errs.append(f'{k} 앞뒤에 공백이 있음')
    if errs:
        return errs, warns

    word = src['word']

    pos = ko['pos'].split(', ')
    if not all(p in POS for p in pos):
        errs.append(f'pos 가 틀림 ({" ".join(POS)} 중 하나, 둘 이상이면 ", " 로): {ko["pos"]!r}')
    elif len(set(pos)) != len(pos) or len(pos) > 3:
        errs.append(f'pos 중복 또는 3개 초과: {ko["pos"]!r}')

    m = ko['meaning_ko']
    items = m.split(', ')
    if SPLIT_CHARS_RE.search(m):
        errs.append(f'meaning_ko 에 ; · / 가 있음 (채점기가 항목을 나눔): {m!r}')
    elif any(',' in x or x != x.strip() or not x for x in items):
        errs.append(f'meaning_ko 구분자는 ", " (쉼표 + 공백 하나)만: {m!r}')
    elif not 1 <= len(items) <= 3:
        errs.append(f'meaning_ko 가 {len(items)}개 (1–3개): {m!r}')
    elif not all(HANGUL_RE.search(re.sub(r'\(.*?\)', '', x)) for x in items):
        errs.append(f'meaning_ko 에 (괄호 밖) 한글이 없는 항목이 있음: {m!r}')
    elif len({re.sub(r'\(.*?\)|\s', '', x) for x in items}) != len(items):
        errs.append(f'meaning_ko 중복 (괄호 · 공백을 빼면 같은 항목): {m!r}')
    else:
        if LATIN_RE.search(m):
            warns.append(f'meaning_ko 에 영문자가 있음: {m!r}')
        if re.search(r'[.!?"]', m):
            warns.append(f'meaning_ko 에 문장부호 · 따옴표가 있음: {m!r}')

    ex = ko['example_en']
    if HANGUL_RE.search(ex):
        errs.append('example_en 에 한글이 있음')
    elif not whole_word_re(word).search(ex):
        errs.append(f'example_en 에 표제어 "{word}" 가 철자 그대로 온전한 낱말로 없음: {ex!r}')
    else:
        extra = sorted({x for x in web_blank_re(word).findall(ex) if x.lower() != word.lower()})
        if extra:
            warns.append(f'빈칸 처리가 다른 낱말까지 가림 {extra}: {ex!r}')
        n = len(ex.split())
        if not 8 <= n <= 18:
            warns.append(f'example_en 이 {n}낱말 (8–18): {ex!r}')
        if not ex.endswith(('.', '?', '!')):
            warns.append(f'example_en 이 . ? ! 로 끝나지 않음: {ex!r}')
        if '’' in ex or '“' in ex or '”' in ex:
            warns.append(f"example_en 에 굽은 따옴표가 있음 (곧은 ' \" 를 쓴다): {ex!r}")

    if not HANGUL_RE.search(ko['example_ko']):
        errs.append(f'example_ko 에 한글이 없음: {ko["example_ko"]!r}')
    return errs, warns


def to_note(e: dict) -> dict:
    f = {
        'word': e['word'],
        'pos': e['pos'],
        'meaning_ko': e['meaning_ko'],
        'example_en': e['example_en'],
        'example_ko': e['example_ko'],
        'list': e['list'],
    }
    return {'id': note_id(e['word']), 'track': 'toeic', 'fields': f}


def main() -> int:
    batch_dir = arg('--dir', DEFAULT_DIR)
    out = arg('--out', DEFAULT_OUT)

    inputs = sorted(p for p in batch_dir.glob('*.json') if BATCH_RE.match(p.stem))
    stray = sorted(p.name for p in batch_dir.glob('*.ko.json') if not BATCH_RE.match(p.name[: -len('.ko.json')]))

    # id 는 번역 여부와 상관없이 전체 입력에서 미리 검사한다.
    id_errs: list[str] = []
    ids: dict[str, str] = {}
    for p in inputs:
        for s in json.loads(p.read_text(encoding='utf-8')):
            i = note_id(s['word'])
            if not NOTE_ID_RE.match(i):
                id_errs.append(f'id 형식이 틀림: {i!r} ({s["word"]!r})')
            elif i in ids:
                id_errs.append(f'id 가 겹침: {i} ({ids[i]!r}, {s["word"]!r})')
            ids.setdefault(i, s['word'])
    for x in id_errs:
        print(f'[id] ERROR {x}')

    notes: list[dict] = []
    total_err, total_warn, done = len(id_errs), 0, 0
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

        src_words = [e['word'] for e in src]
        ko_words = [e.get('word') for e in ko]
        n_err = n_warn = 0
        if set(src_words) != set(ko_words) or len(ko_words) != len(src_words):
            lost = [w for w in src_words if w not in ko_words]
            added = [w for w in ko_words if w not in src_words]
            dup = sorted({str(w) for w in ko_words if ko_words.count(w) > 1})
            problems.append(f'ERROR 단어 집합이 다름 — 빠짐 {lost or "-"}, 추가 {added or "-"}, 중복 {dup or "-"}')
            n_err += 1
        elif ko_words != src_words:
            problems.append('WARN 순서가 입력과 다름 (입력 순서로 합침)')
            n_warn += 1

        by_word = {e.get('word'): e for e in ko}
        for s in src:
            k = by_word.get(s['word'])
            if k is None:
                continue
            errs, warns = check_entry(s, k)
            for x in errs:
                problems.append(f'ERROR {s["word"]}: {x}')
            for x in warns:
                problems.append(f'WARN  {s["word"]}: {x}')
            n_err += len(errs)
            n_warn += len(warns)
            if not errs:
                notes.append(to_note({**s, **{f: k[f] for f in TRANSLATED}}))
        total_err += n_err
        total_warn += n_warn
        done += 1
        print(f'[{p.stem}] {len(src)}단어 — 오류 {n_err}, 경고 {n_warn}')
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
