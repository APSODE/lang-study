"""한자 예시 단어 · 예문(<묶음>.ex.json) 검사와 content/kanji.json 반영.
  python3 -I tools/kanji/check-examples.py [묶음...]   검사만 (기본: 있는 .ex.json 전부)
  python3 -I tools/kanji/check-examples.py --apply      검사 통과한 묶음을 content/kanji.json 에 반영
반영 뒤에는 import-content content/kanji.json 으로 DB 에 넣는다. 끊겨도 .ex.json 이 있는 묶음만 처리하므로 다시 돌리면 된다.
"""
import glob, json, os, re, sys
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
B = os.path.join(ROOT, 'content-src', 'kanji', 'batches')
HIRA = re.compile(r'^[぀-ゟ゠-ヿー、。！？・「」\s]+$')
HANGUL = re.compile(r'[가-힣]')

def check(name):
    src = json.load(open(os.path.join(B, f'{name}.ko.json'), encoding='utf-8'))
    ex = json.load(open(os.path.join(B, f'{name}.ex.json'), encoding='utf-8'))
    errs = []
    if [e['kanji'] for e in src] != [e.get('kanji') for e in ex]:
        errs.append('한자 집합 · 순서가 입력과 다름')
        return errs, ex
    for e in ex:
        k = e['kanji']; xs = e.get('examples'); s = e.get('sentence')
        if not isinstance(xs, list) or not 1 <= len(xs) <= 2: errs.append(f'{k}: examples 1–2개'); continue
        for x in xs:
            if k not in x.get('word', ''): errs.append(f'{k}: 낱말에 한자가 없음 {x.get("word")!r}')
            if not HIRA.match(x.get('reading', '')): errs.append(f'{k}: reading 은 가나만 {x.get("reading")!r}')
            if not HANGUL.search(x.get('meaning_ko', '')) or ',' in x.get('meaning_ko', ''): errs.append(f'{k}: meaning_ko {x.get("meaning_ko")!r}')
        if not isinstance(s, dict): errs.append(f'{k}: sentence 없음'); continue
        if k not in s.get('ja', '') or not s['ja'].endswith('。'): errs.append(f'{k}: ja 에 한자가 없거나 。로 안 끝남 {s.get("ja")!r}')
        if not HIRA.match(s.get('kana', '')): errs.append(f'{k}: kana 는 가나만 {s.get("kana")!r}')
        if not HANGUL.search(s.get('ko', '')): errs.append(f'{k}: ko {s.get("ko")!r}')
    return errs, ex

def main():
    apply = '--apply' in sys.argv
    names = [a for a in sys.argv[1:] if not a.startswith('--')] or sorted(
        os.path.basename(p)[:-8] for p in glob.glob(os.path.join(B, '*.ex.json')))
    ok, total_err = {}, 0
    for n in names:
        errs, ex = check(n)
        print(f'[{n}] {len(ex)}자 — 오류 {len(errs)}')
        for e in errs[:30]: print('    ERROR', e)
        total_err += len(errs)
        if not errs: ok[n] = ex
    done = {os.path.basename(p)[:-8] for p in glob.glob(os.path.join(B, '*.ex.json'))}
    todo = sorted(os.path.basename(p)[:-8] for p in glob.glob(os.path.join(B, '*.ko.json')) if os.path.basename(p)[:-8] not in done)
    print(f'예문 있는 묶음 {len(done)} · 남은 묶음 {len(todo)}: {" ".join(todo)}')
    if apply:
        path = os.path.join(ROOT, 'content', 'kanji.json')
        notes = json.load(open(path, encoding='utf-8'))
        by = {n['fields']['kanji']: n for n in notes}
        cnt = 0
        for ex in ok.values():
            for e in ex:
                f = by[e['kanji']]['fields']
                f['examples'] = e['examples']; f['sentences'] = [e['sentence']]
                by[e['kanji']]['fields'] = dict(sorted(f.items())); cnt += 1
        open(path, 'w', encoding='utf-8').write(json.dumps(notes, ensure_ascii=False, indent=2) + '\n')
        print(f'content/kanji.json 에 {cnt}자 반영')
    sys.exit(1 if total_err else 0)

main()
