# 안심글꼴 수동 반입 (public/fonts)

한국 관공서 문서용 **안심글꼴**(상업적·웹 사용 100% 무료)을 이 폴더에 넣고 폰트
레지스트리에 등록하면, 에디터 글꼴 목록의 **"안심글꼴"** 그룹에 나타난다.

## 규칙 (반드시)
- **웹 임베딩/self-host가 명시적으로 허용된 폰트만.** "인쇄만 허용", 라이선스 불명확,
  상용(휴먼·HY·윤 등) 폰트는 **금지**. (상용 폰트를 쓰고 싶으면 `compat` 폰트를 볼 것 —
  화면은 닮은꼴, 파일엔 원명 선언.)
- 형식은 **woff2** 권장(가볍다). TTF만 있으면 woff2로 변환(`fonttools`/온라인) 후 넣기.

## 반입 절차
1. `public/fonts/`에 woff2 파일을 넣는다. 예: `KoPubWorldBatangLight.woff2`
2. `src/modules/document/fonts.ts`의 FONTS 배열에 항목 추가:
   ```ts
   {
     key: "kopub-batang", label: "KoPub 바탕", category: "safe",
     webFamily: "KoPubWorld Batang",   // @font-face family (localSrc가 이 이름으로 주입)
     hwpxName: "KoPubWorld바탕체",       // 한글에서 열 때 선언될 이름
     weights: [400, 700],
     localSrc: [
       { url: "/fonts/KoPubWorldBatangLight.woff2", weight: 400 },
       { url: "/fonts/KoPubWorldBatangBold.woff2", weight: 700 },
     ],
   },
   ```
3. 끝. 선택 시 `ensureFont`가 @font-face를 주입하고 전각(1em) 보정값을 실측한다.

## 추천 안심글꼴 (예)
- **KoPub World 바탕/돋움** — 한국출판인회의, 상업 무료. 공문 본문에 적합.
- **나눔스퀘어 / 나눔스퀘어라운드** — 네이버.
- **공공누리 안심글꼴** — 문체부·저작권위(공유마당) 배포.
- 지자체 안심글꼴 (서울한강체 등) — 각 배포처 라이선스 확인.

> 라이선스 전문 파일을 LICENSES/ 폴더에 함께 넣는다(동봉 요구 라이선스가 대부분 — saas-gates G6). 출처·라이선스 URL을 항목 주석에 남겨두면 나중에 감사에 대응하기 쉽다.
