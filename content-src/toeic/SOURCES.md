# 토익 단어 데이터 출처 · 라이선스

`content-src/toeic/` 의 파일(base.json, batches/, merged.json)과 이것으로 만든 toeic 노트는 아래 자료에서 왔다.
사이트에 출처 페이지(credits)를 만들 때 이 문서를 그대로 옮긴다.

## 1. TOEIC Service List (TSL) 1.2 — CC BY-SA 4.0

- 만든 사람: Charles Browne, Brent Culligan
- 사이트: https://www.newgeneralservicelist.com/toeic-service-list (NGSL 프로젝트 사이트)
- 라이선스: Creative Commons Attribution-ShareAlike 4.0 International (https://creativecommons.org/licenses/by-sa/4.0/)
  - 사이트의 문구 (2026-11-10 확인): "TOEIC Service List by Browne, C. and Culligan, B., is licensed under a Creative Commons
    Attribution-ShareAlike 4.0 International License. Permissions beyond the scope of this license may be available at
    www.charlie-browne.com."
- 판: **TSL 1.2** (2026-11-10 받음)
- 받은 파일 (`tools/toeic/.cache/`, git 제외 — `python3 -I tools/toeic/build-base.py` 가 다시 받는다):
  - `TSL_12_stats.csv` — https://www.newgeneralservicelist.com/s/TSL_12_stats.csv
    sha256 `2259df25a1077b04067ef0c0e9e4c98b46c91e4d539741dfaceba88651ff486d`
  - `TSL_12_lemmatized_for_teaching.csv` — https://www.newgeneralservicelist.com/s/TSL_12_lemmatized_for_teaching.csv
    sha256 `aca322f1e8b55c9c85e8b9f04ea384a2fcb069019e6e77fff3eb141ee2b67929`
- 쓴 것
  - `TSL_12_stats.csv`: 표제어(`word`), TSL 순위(`rank`, 1–1250, 이 순서를 그대로 유지), SFI(`sfi`), U(`u`).
    `#N/A` 인 값(correctly, birthday, textbook, semester, ma'am)은 `sfi` · `u` 를 뺐다.
  - `TSL_12_lemmatized_for_teaching.csv`: 표제어별 흔한 변화형(`forms`, 번역 참고용). 이 표의 표제어가 `outdate` · `unauthorize` 로
    다른 `outdated` · `unauthorized` 는 `forms` 가 없다.
- 제외한 표제어: 없음 (1250개 모두 실제 낱말. fax · memo · tech · auto · mini 같은 줄임말도 그 자체로 쓰이는 낱말이라 둠).
- 참고: TSL 은 토익 교재 · 모의고사 코퍼스(약 156만 낱말)에서 NGSL 에 없는 토익 빈출어를 뽑은 목록이다 (NGSL 과 함께 쓰도록 만든 보충 목록).

### 지켜야 할 것 (CC BY-SA 4.0)

- **출처 표시**: 데이터를 보여주는 사이트 · 앱의 출처 페이지에 저작자 · 제목 · 라이선스 · 링크를 둔다.
  > TOEIC Service List (TSL) 1.2 by Browne, C. and Culligan, B., licensed under
  > [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). https://www.newgeneralservicelist.com
  
  (한국어 병기 예: "토익 단어 목록: Browne · Culligan 의 TOEIC Service List 1.2, CC BY-SA 4.0")
- **변경 사실 표시**: 원본을 가공했음을 밝힌다 (예: "표제어 · 순위만 골라 쓰고 품사 · 한국어 뜻 · 예문 · 예문 해석을 추가함").
- **동일 조건 변경 허락(ShareAlike)**: TSL 을 가공 · 확장한 것 — 이 폴더의 base.json · batches · merged.json, 그리고 TSL 단어에
  **우리가 만든 품사 · 한국어 뜻 · 영어 예문 · 예문 해석을 붙인 toeic 노트 전체** — 는 TSL 의 2차 저작물로 보고 **CC BY-SA 4.0 으로 공개**하며,
  다른 사람이 같은 조건으로 쓸 수 있게 한다. 내보낸 콘텐츠 JSON(git 저장소)에 이 라이선스를 밝힌다.
- 추가 제한을 걸지 않는다 (DRM · 더 좁은 이용 조건 금지).
- 앱 코드 자체는 ShareAlike 대상이 아니다 (데이터만).

## 2. 품사 · 한국어 뜻 · 예문 (pos, meaning_ko, example_en, example_ko)

- AI 번역 에이전트가 `TRANSLATE.md` 에 따라 작성하고, `tools/toeic/merge.py` 로 검사한 뒤 사람이 검토한다.
- 시판 단어장 · 교재 · 기출 문장을 옮기지 않는다 (예문은 새로 지은 것).
- TSL 의 2차 저작물로서 CC BY-SA 4.0 으로 공개한다.

## 출처 페이지(credits)에 넣을 문구 요약

- 토익 단어 목록 · 순위: TOEIC Service List 1.2, Browne, C. & Culligan, B., CC BY-SA 4.0 (newgeneralservicelist.com)
- 토익 노트(품사 · 한국어 뜻 · 예문 포함): NakamuraProject, CC BY-SA 4.0
