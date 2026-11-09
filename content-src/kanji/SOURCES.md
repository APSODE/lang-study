# 한자 데이터 출처 · 라이선스

`content-src/kanji/` 의 파일(base.json, batches/, merged.json)과 이것으로 만든 kanji 노트는 아래 자료에서 왔다.
사이트에 출처 페이지(credits)를 만들 때 이 문서를 그대로 옮긴다.

## 1. KANJIDIC2 — CC BY-SA 4.0

- 제공: Electronic Dictionary Research and Development Group (EDRDG), KANJIDIC Project
- 주소: http://www.edrdg.org/kanjidic/kanjidic2.xml.gz (설명: http://www.edrdg.org/wiki/index.php/KANJIDIC_Project)
- 라이선스: Creative Commons Attribution-ShareAlike 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), EDRDG 라이선스 문서 http://www.edrdg.org/edrdg/licence.html
- 받은 판: `database_version` 2026-313, `date_of_creation` 2026-11-09 (2026-11-09 받음)
- 쓴 것: 음독(ja_on), 훈독(ja_kun), 획수(첫 stroke_count), 빈도(freq), 영어 뜻(m_lang 없는 meaning), 한국 한자음(korean_h → `eum_ko`)

### 지켜야 할 것 (CC BY-SA + EDRDG 조건)

- **출처 표시**: 데이터를 보여주는 사이트 · 앱에 아래 문구와 링크를 둔다.
  > This site uses the KANJIDIC2 dictionary file. This file is the property of the
  > [Electronic Dictionary Research and Development Group](http://www.edrdg.org/), and is used in
  > conformance with the Group's [licence](http://www.edrdg.org/edrdg/licence.html).
  
  (한국어 병기 예: "이 사이트는 EDRDG 의 KANJIDIC2 사전 파일을 그 라이선스에 따라 사용합니다.")
- **동일 조건 변경 허락(ShareAlike)**: KANJIDIC2 에서 나온 데이터를 고치거나 합친 것(읽기 · 획수 · 영어 뜻 · 한국 음과,
  이를 바탕으로 만든 한국어 뜻 · 훈음이 들어 있는 한자 노트)은 **CC BY-SA 4.0 으로 공개**해야 하며, 다른 사람이 같은 조건으로
  쓸 수 있게 해야 한다. 내보낸 콘텐츠 JSON(git 저장소)에 이 라이선스를 밝힌다.
- **변경 사실 표시**: 원본을 가공했음을 밝힌다 (예: "JLPT 레벨 한자만 골라 필드를 줄이고 한국어 뜻 · 훈음을 추가함").
- **갱신**: EDRDG 는 공개 서비스가 사전 파일을 주기적으로 새 판으로 바꾸기를 요청한다. `tools/kanji/build-base.py --refresh` 로 다시 받는다.
- 앱 코드 자체는 ShareAlike 대상이 아니다 (데이터만).

## 2. JLPT 레벨(N5–N1) — Jonathan Waller 목록, CC BY / 가공본 MIT

공식 JLPT 한자 목록은 2010년 개정 이후 공개되지 않는다. 그래서 널리 쓰이는 커뮤니티 목록을 쓴다.

- 직접 받은 것: davidluzgouveia/kanji-data `kanji.json` 의 `jlpt_new` 필드만
  - 주소: https://github.com/davidluzgouveia/kanji-data (raw: https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json)
  - 판: master, 커밋 `00fd7079c3890f430759536f91aa5e854ec0ca4f` (2026-02-27), 2026-11-09 받음
  - 라이선스: **MIT** (Copyright (c) 2019 David Gouveia). 아래 고지를 함께 둔다.
  - 이 저장소의 README 는 JLPT 데이터 출처로 Jonathan Waller 의 JLPT Resources 를 든다. 나머지 필드(KANJIDIC · WaniKani)는 쓰지 않는다.
- 원 출처: Jonathan Waller, JLPT Resources — http://www.tanos.co.uk/jlpt/
  - 라이선스: **Creative Commons Attribution (CC BY)**. "Use my data!" 페이지(http://www.tanos.co.uk/jlpt/sharing/,
    2011-10-12 갱신, 웹 아카이브로 확인): "Everything on this site (that I'm not selling), is licenced under Creative Commons "BY" …
    use anything here however you like (commercial or non-commercial), but credit my site. (A link would be nice.)"
  - 지켜야 할 것: 출처 페이지에 Jonathan Waller 와 사이트 링크를 밝힌다.
- 참고: 이 목록은 2010년 이전 4단계 시험 목록을 바탕으로 새 N 단계에 맞춰 나눈 추정치다. 공식 목록이 아니며, N1 에는 인명용 한자도 일부 들어 있다.

### MIT 고지 (kanji-data)

```
MIT License

Copyright (c) 2019 David Gouveia

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 3. 한국어 뜻 · 훈음 (meanings_ko, hunum_ko)

- AI 번역 에이전트가 `TRANSLATE.md` 에 따라 KANJIDIC2 영어 뜻과 일본어 읽기를 참고해 작성하고, `tools/kanji/merge.py` 로 검사한 뒤 사람이 검토한다.
- KANJIDIC2 의 2차 저작물이므로 CC BY-SA 4.0 으로 공개한다.

## 출처 페이지(credits)에 넣을 문구 요약

- 한자 읽기 · 획수 · 영어 뜻 · 한국 한자음: KANJIDIC2, © EDRDG, CC BY-SA 4.0 (위 문구 + 링크)
- JLPT 레벨: Jonathan Waller, JLPT Resources (tanos.co.uk), CC BY / 가공: David Gouveia, kanji-data, MIT
- 한자 노트(한국어 뜻 · 훈음 포함): NakamuraProject, CC BY-SA 4.0
