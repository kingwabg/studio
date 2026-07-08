# Phase 2 설계 — Supabase 연동 (저장·회원·자산) + 에디터 실무 기능

- 전제: Phase 1(모듈형 캔버스 `/studio`) 완료. 기존 앱 `/`는 무손상.
- 원칙 유지: **문서 = JSON 한 덩어리(진실)**. 그래서 영속화가 `jsonb` 한 컬럼으로 끝난다.
- 목표: 이 단계에서 앱이 "장난감 → 제품"이 된다 (새로고침해도 문서가 남는다).

## 0. 사용자가 먼저 해야 하는 것 (구현 언블록)

Supabase 프로젝트는 내가 못 만든다. 아래를 준비해주면 구현 시작 가능:
1. supabase.com에서 프로젝트 생성 (region: `Northeast Asia (Seoul)` 권장)
2. Project Settings → API 에서:
   - **Project URL** + **anon key** → 알려줘도 안전 (RLS가 데이터를 지킴). `.env.local`에 넣는다.
   - **service_role key** → 절대 클라이언트/깃에 금지. Edge Function 시크릿으로만.
3. Anthropic API 키는 Edge Function 시크릿(`ANTHROPIC_API_KEY`)으로만 — 클라이언트 금지.

## 1. 데이터 모델 (Postgres + RLS)

```sql
-- 회원 프로필 (auth.users 1:1 확장)
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  created_at timestamptz default now()
);

-- 문서 = jsonb 한 덩어리 (CanvasDoc 또는 흐름 doc). 진실.
create table documents (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade,
  title text not null default '제목 없는 문서',
  surface text not null default 'canvas',      -- 'canvas' | 'flow'
  data jsonb not null default '{}'::jsonb,      -- 문서 전체 JSON
  thumbnail_path text,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);
create index on documents (owner, updated_at desc);

-- Storage 객체 메타데이터 (직인·영수증·이미지) + 태깅 (Phase 3 검색의 씨앗)
create table assets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade,
  document_id uuid references documents on delete set null,
  bucket text not null, path text not null,
  kind text not null default 'image',           -- 'image'|'stamp'|'receipt'
  tags text[] default '{}',
  created_at timestamptz default now()
);

-- 표 자동완성용 내부 데이터셋
create table datasets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users on delete cascade,
  name text not null,
  rows jsonb not null default '[]'::jsonb,       -- [{컬럼: 값, ...}]
  created_at timestamptz default now()
);
```

**RLS (전 테이블 동일 패턴 — 소유자만 CRUD):**
```sql
alter table documents enable row level security;
create policy "own rows" on documents
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
-- profiles/assets/datasets 도 같은 정책. profiles는 id = auth.uid().
```

## 2. Storage

- 버킷 `assets` (private). 경로 규약: `{user_id}/{document_id}/{uuid}.{ext}`
- Storage 정책: 객체 이름이 `auth.uid()/…` 프리픽스일 때만 read/write (본인 파일만).
- 썸네일은 당장 `assets`에 같이(또는 `thumbnails` 버킷). 갤러리 공개는 사업 단계에서.

## 3. 클라이언트 연동 (진실은 그대로 Zustand)

```
src/lib/supabase.ts                 createClient(URL, ANON_KEY) — 세션 영속
src/modules/document/repository.ts  list/get/create/save/deleteDocument (documents 테이블)
src/modules/auth/AuthGate.tsx       세션 없으면 로그인 화면, 있으면 children
src/routes/StudioHome.tsx           내 문서 목록(제목·수정일·썸네일) → 열기
src/routes/StudioEditor.tsx         오토세이브(스토어 변경 → 1.5s 디바운스 → saveDocument)
```

- **오토세이브**: `useCanvasStore` 구독 → 디바운스 → `documents.data = doc` 저장. "저장됨" 표시.
- **로드**: 홈에서 문서 클릭 → `getDocument(id)` → `store.load(doc)` → 에디터.
- 핵심: `data` 컬럼 = CanvasDoc JSON 그대로. 스키마 마이그레이션 없이 모델이 진화한다.

## 4. AI 프록시 (보안 해결 — Phase 4 앞당겨 이번에)

Edge Function `ai-generate` (Deno):
- 시크릿 `ANTHROPIC_API_KEY` 보유. 요청자의 Supabase JWT 검증(로그인 사용자만).
- body `{prompt, system}` → Anthropic Messages API 호출 → content 반환.
- 클라이언트: `supabase.functions.invoke('ai-generate', {body})`.
- 기존 `DocumentStudio.jsx`의 브라우저 직접 fetch를 이걸로 교체 → 프로덕션에서 동작 + 키 안전.
- 사용량 제한(요금제 차등의 씨앗)은 여기서 사용자별 카운트로.

## 5. 에디터 실무 기능 (신규 캔버스에 추가)

- **맞춤형 스냅 영역** (`modules/canvas/snap.ts`): 드래그 중 x/y를 격자(기본 5mm)·이웃 블록
  가장자리·명명된 스냅 영역(`doc.zones[]`)에 흡착. dnd-kit modifier로 적용.
- **구역별 잠금**: `Block.locked` + `Zone.locked`. 잠긴 블록은 useDraggable 비활성 +
  우측 패널 잠금 토글. "요소는 페이지 밖으로 못 나감"에 이어 "잠긴 요소는 안 움직임" 불변식.
- **표 자동완성**: table 블록에 `binding {datasetId, columns[]}` 부여 → `datasets`에서 행 채움.
  내부 데이터 바뀌면 표가 갱신. 공문서 반복 작업(영수증 목록 등) 자동화의 핵심.

## 6. 권장 구현 순서 (Phase 2 내부)

1. Supabase 프로젝트 + `lib/supabase.ts` + **Auth 게이트** (`/studio` 로그인 필요)
2. DB 스키마 + RLS 적용
3. **문서 영속화** (repository + 오토세이브 + 홈 목록) ← 제품화 분기점, 최우선
4. Storage (이미지/직인/영수증 업로드 → image 블록 src)
5. **AI 프록시** Edge Function (보안)
6. 에디터 기능: 스냅 → 잠금 → 표 자동완성

## 7. 환경/배포

- `.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (anon은 노출 안전, RLS가 방어)
- Vercel: 같은 env 등록. Edge Function 시크릿은 Supabase 대시보드/CLI로.
- `.gitignore`에 `.env.local` 이미 포함됨 ✓
