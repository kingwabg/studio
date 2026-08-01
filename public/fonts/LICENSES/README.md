# 번들 글꼴 출처·라이선스

| 파일 | 글꼴 | 라이선스 | 쓰이는 곳 |
|------|------|----------|-----------|
| `KoPubWorld-*.woff2` | KoPub World 바탕·돋움 | [KoPub-NOTICE.txt](KoPub-NOTICE.txt) | 문서 본문 · 서명 「정자체」 |
| `NanumSquare*.woff2` | 나눔스퀘어 계열 | [OFL-1.1.txt](OFL-1.1.txt) | 문서 본문 |
| `NanumPenScript.woff2` | 나눔손글씨 펜 (Nanum Pen Script) | [OFL-1.1.txt](OFL-1.1.txt) | 서명 「펜글씨」 |
| `NanumBrushScript.woff2` | 나눔손글씨 붓 (Nanum Brush Script) | [OFL-1.1.txt](OFL-1.1.txt) | 서명 「붓글씨」 |
| `Gaegu.woff2` | 개구쟁이 (Gaegu) | [OFL-1.1.txt](OFL-1.1.txt) | 서명 「또박또박」 |

손글씨 3종은 Google Fonts 배포판의 **korean subset(weight 400)** 만 담았다
(`@fontsource/{nanum-pen-script,nanum-brush-script,gaegu}@5.3.0` 의 `files/*-korean-400-normal.woff2`).
전체 굵기·언어를 다 넣으면 수십 MB 라 서명 한 줄 쓰자고 얹을 무게가 아니다.

⚠ 이 글꼴들은 **문서 본문 글꼴 대장(`src/core/font-loader.ts`)에 넣지 않는다** — 서명
대화상자가 열릴 때만 FontFace 로 따로 싣는다. 글꼴 고르기 목록에 나타나면 안 된다.
