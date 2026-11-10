# 토플 단어 데이터 출처 · 라이선스

`content-src/toefl/` 의 파일(base.json, batches/, merged.json)과 이것으로 만든 toefl 노트는 아래 자료에서 왔다.
사이트에 출처 페이지(credits)를 만들 때 이 문서를 그대로 옮긴다.

## 1. New Academic Word List (NAWL) 1.2 — CC BY-SA 4.0

- 만든 사람: Charles Browne, Brent Culligan, J. Phillips
- 사이트: https://www.newgeneralservicelist.com/new-academic-word-list (NGSL 프로젝트 사이트)
- 라이선스: Creative Commons Attribution-ShareAlike 4.0 International (https://creativecommons.org/licenses/by-sa/4.0/)
  - 사이트의 문구 (2026-11-10 확인): "New Academic Word List by Browne, C., Culligan, B., and Phillips, J. is licensed under a
    Creative Commons Attribution-ShareAlike 4.0 International License. Permissions beyond the scope of this license may be
    available at www.charlie-browne.com."
  - 사이트가 권하는 인용: Browne, C., Culligan, B. (2013). The New Academic Word List. Retrieved from http://www.newgeneralservicelist.com
- 판: **NAWL 1.2** (957 낱말, 2026-11-10 받음)
- 받은 파일 (`tools/toefl/.cache/`, git 제외 — `python3 -I tools/toefl/build-base.py` 가 다시 받는다):
  - `NAWL_12_stats.csv` — https://www.newgeneralservicelist.com/s/NAWL_12_stats.csv
    sha256 `4c99a9512730496fb19b7fbdd69831a1333ac3dd5f10cafb71487dd03c8f41f0`
    (페이지의 "NAWL 1.2 list with basic statistics" 파일. 페이지 링크에서 바로 찾지 못해 TSL 과 같은 이름 규칙으로 받았다 — 957줄, 머리줄 `Word,Rank,Band,SFI,U`)
  - `NAWL_12_lemmatized_for_teaching.csv` — https://www.newgeneralservicelist.com/s/NAWL_12_lemmatized_for_teaching.csv
    sha256 `1790b0fa22c5815ebf5a9a15c9363c03a6e906c77bf217f99033734f1459137b`
- 쓴 것
  - `NAWL_12_stats.csv`: 표제어(`word`), NAWL 순위(`rank`, 1–957, 이 순서를 그대로 유지), Band(`band`), SFI(`sfi`), U(`u`).
    파일은 알파벳 순이고 순위는 `Rank` 열에 있다. 빈 값 · 겹치는 순위 없음.
  - `NAWL_12_lemmatized_for_teaching.csv`: 표제어별 흔한 변화형(`forms`, 번역 참고용).
    - 빈도 표의 `headquarters` 는 교육용 표에서 `headquarter` 로 되어 있어 그 줄의 변화형을 썼다.
    - 교육용 표에만 있는 `criteria`, `founds` 는 순위가 없어 뺐다.
- 제외한 표제어 (base.json 에서): 없음 (957개 모두 넣음).
- 특이한 표제어 (그대로 둠): `descendent` (보통 철자 descendant), 코퍼스 조각처럼 보이는 짧은 표제어
  `par`, `ion`, `ex`, `sin`, `pi`, `mid`, `non`, `pre`, `trans`, `semi`, `multi`, `micro`, `neo` — TRANSLATE.md 에 쓰는 법을 적었다.
- 참고: NAWL 은 2억 8800만 낱말 학술 코퍼스에서 NGSL 에 없는 학술 빈출어를 뽑은 목록이다 (NGSL 과 함께 쓰도록 만든 보충 목록,
  Coxhead 의 AWL 을 대신하도록 만듦).

### 토익 단어와 겹치는 표제어 — 번역 묶음에서 뺌

`content/toeic.json`(TSL 1250개)에 같은 표제어가 있는 NAWL 단어 **230개**는 `batches/` 에 넣지 않았다 (base.json 에는 남아 있음).
노트 id 는 `toeic-` · `toefl-` 로 달라 부딪히지 않지만, 같은 단어를 두 트랙에서 두 번 공부하게 되므로 뺐다 (2026-11-10 결정).
`headquarters` 는 토익의 `headquarter` 와 같은 낱말로 보고 뺐다. 나머지는 표제어가 정확히 같은 것.
번역할 단어는 957 − 230 = **727개** (묶음 6개).

obtain(2), distribution(3), aspect(5), dynamic(6), impact(7), publish(9), authority(11), graph(18), stimulus(27), bound(35), translation(40), identification(57), partial(59), duration(65), consumption(67), similarity(70), coordinate(82), calculation(83), precede(84), orientation(87), prediction(98), correspondence(99), transmission(109), dose(110), occurrence(111), activate(124), facilitate(129), induction(131), commonly(134), accuracy(136), projection(144), dependence(147), evident(153), chronic(158), integral(159), specification(169), classify(170), physician(171), indicator(175), feedback(178), compact(185), diagram(186), tropical(187), defect(191), valid(195), embed(199), utility(201), verbal(204), diagnostic(218), inference(232), modification(243), biology(249), contrary(252), effectiveness(258), logical(260), usage(262), client(266), superior(269), approximate(270), comprehension(275), appendix(286), overview(287), partially(300), preliminary(301), transaction(304), prominent(305), indirect(312), assembly(314), strictly(315), closure(320), minimize(321), availability(323), adjacent(329), questionnaire(333), generalization(334), locally(338), reinforce(340), terminal(346), informal(347), occupation(357), productivity(360), reproduce(362), simplify(367), assignment(375), mechanical(377), contradiction(381), correction(384), ethics(388), consent(391), separately(395), mineral(400), reliability(402), insert(407), productive(412), transmit(416), resemble(419), circulation(420), correctly(421), necessity(422), accumulate(427), maximize(429), replacement(430), complication(432), likewise(438), elevate(445), plausible(449), rewrite(454), manual(455), strategic(456), absorb(458), sketch(459), lifetime(461), definite(463), workshop(479), meaningful(481), diagnose(483), accent(484), admission(488), clarify(490), formally(504), accurately(506), influential(507), scholarship(511), stack(521), carrier(530), ray(536), bulk(540), traditionally(544), merge(551), clinic(556), allocate(557), architect(561), economist(565), rainfall(573), expertise(578), actively(580), textbook(584), flexibility(588), cord(589), realistic(590), consultation(593), compensate(600), pole(612), puzzle(613), exit(616), circulate(618), contradict(620), interfere(621), physics(628), retrieve(631), artistic(636), faculty(637), chemistry(642), goods(647), shortly(648), irrelevant(651), mechanic(652), fatigue(655), bargain(657), individually(659), ton(679), machinery(688), vitamin(690), leisure(692), clue(696), bacteria(703), portfolio(714), lifestyle(716), economically(725), interrupt(734), layout(745), fabric(746), container(747), afterward(756), jazz(757), unemployed(759), forum(763), overhead(765), comply(769), audit(770), slot(772), media(775), tempt(776), outlet(777), apple(781), planner(782), destination(795), lab(799), seminar(800), subtract(804), gram(815), messenger(821), tremendous(825), stripe(834), junior(835), kilometer(837), spray(840), cinema(841), plug(842), erase(845), clip(848), statistics(853), parcel(859), lecturer(860), poster(862), auction(865), mentor(867), liter(872), noisy(875), headquarters(876), specialty(881), campus(886), sometime(889), recipe(892), airplane(893), neat(897), semester(901), bonus(905), memorize(910), whoever(912), deadline(922), homework(928), cheer(931), shuttle(932), athletic(934), tech(948), rack(949), calculator(952), mall(953), stadium(956)

(괄호 안은 NAWL 순위. 목록은 `python3 -I tools/toefl/build-base.py` 출력과 같다.)

### 지켜야 할 것 (CC BY-SA 4.0)

- **출처 표시**: 데이터를 보여주는 사이트 · 앱의 출처 페이지에 저작자 · 제목 · 라이선스 · 링크를 둔다.
  > New Academic Word List (NAWL) 1.2 by Browne, C., Culligan, B., and Phillips, J., licensed under
  > [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). https://www.newgeneralservicelist.com

  (한국어 병기 예: "토플 단어 목록: Browne · Culligan · Phillips 의 New Academic Word List 1.2, CC BY-SA 4.0")
- **변경 사실 표시**: 원본을 가공했음을 밝힌다 (예: "표제어 · 순위만 골라 쓰고 토익 목록과 겹치는 단어를 빼고 품사 · 한국어 뜻 · 예문 · 예문 해석을 추가함").
- **동일 조건 변경 허락(ShareAlike)**: NAWL 을 가공 · 확장한 것 — 이 폴더의 base.json · batches · merged.json, 그리고 NAWL 단어에
  **우리가 만든 품사 · 한국어 뜻 · 영어 예문 · 예문 해석을 붙인 toefl 노트 전체** — 는 NAWL 의 2차 저작물로 보고 **CC BY-SA 4.0 으로 공개**하며,
  다른 사람이 같은 조건으로 쓸 수 있게 한다.
- 추가 제한을 걸지 않는다 (DRM · 더 좁은 이용 조건 금지).
- 앱 코드 자체는 ShareAlike 대상이 아니다 (데이터만).
- (docs/토플_작업.md: 친구끼리 비공식 · 비상업 용도라 앱에 라이선스 표기는 하지 않기로 함, 2026-11-10 사용자 결정. 이 기록은 남겨 둔다.)

## 2. 품사 · 한국어 뜻 · 예문 (pos, meaning_ko, example_en, example_ko)

- AI 번역 에이전트가 `TRANSLATE.md` 에 따라 작성하고, `tools/toefl/merge.py` 로 검사한 뒤 사람이 검토한다.
- 시판 단어장 · 교재 · 기출 문장을 옮기지 않는다 (예문은 새로 지은 것).
- NAWL 의 2차 저작물로서 CC BY-SA 4.0 으로 공개한다.

## 출처 페이지(credits)에 넣을 문구 요약

- 토플 단어 목록 · 순위: New Academic Word List 1.2, Browne, C., Culligan, B. & Phillips, J., CC BY-SA 4.0 (newgeneralservicelist.com)
- 토플 노트(품사 · 한국어 뜻 · 예문 포함): NakamuraProject, CC BY-SA 4.0

## 접두사 조각 제외 (2026-11-10)

par, ex, mid, non, pre, trans, micro, semi, multi, neo 는 코퍼스의 접두사 조각이라 단어 카드로 쓸 수 없어 묶음에서 뺐다(`tools/toefl/build-base.py` 의 DROP, base.json 에는 남김). 묶음 단어 717개.
- sub · anti 도 접두사라 번역 뒤 nawl-05 에서 뺐다 (묶음 단어 715개).
