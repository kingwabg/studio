// repository.ts — 문서 영속화 경계(port). 앱은 이 인터페이스에만 의존하고,
// 실제 저장소(localStorage / Supabase)는 어댑터로 갈아끼운다.
//
// Phase 2 지금: localRepository(localStorage) — Supabase 프로젝트 없이도 새로고침 유지.
// Phase 2 다음: supabaseRepository가 같은 인터페이스를 구현 → 앱 코드 변경 0으로 교체.
import { type CanvasDoc } from "./model";
import { localRepository } from "./localRepository";

export interface DocMeta {
  id: string;
  title: string;
  surface: "canvas" | "flow";
  updatedAt: number; // epoch ms
}

export interface DocumentRepository {
  list(): Promise<DocMeta[]>; // 최근 수정 순
  get(id: string): Promise<CanvasDoc | null>;
  create(title?: string): Promise<CanvasDoc>;
  save(doc: CanvasDoc): Promise<void>;
  remove(id: string): Promise<void>;
}

// 팩토리 — 환경에 Supabase 설정이 있으면 그걸, 없으면 로컬.
// (localRepository가 이 파일에서 가져오는 건 타입뿐이라 런타임 순환 없음.)
export function getRepository(): DocumentRepository {
  // 다음 단계: if (import.meta.env.VITE_SUPABASE_URL) return supabaseRepository;
  return localRepository;
}
