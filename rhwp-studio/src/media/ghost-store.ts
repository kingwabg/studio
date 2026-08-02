/**
 * 고스트 코멘트 저장소 (v1) — 문서에 **아무것도 안 남기는** 검토 메모.
 *
 * 한컴 메모(문서 IR 안 Control)와 달리 여기 메모는 문서 바이트에 안 들어간다.
 * 그래서 저장은 브라우저 로컬(IndexedDB)이고, 인쇄/PDF 에는 구조상 안 나온다.
 *
 * ponytail: 문서 식별을 파일명으로 한다 — 같은 이름의 다른 문서면 메모가 섞인다.
 *   문서 고유 id 가 생기면 docKey 만 그걸로 바꾸면 된다(레코드 구조는 그대로).
 *
 * template-store 와 같은 IndexedDB + 메모리 폴백 패턴(테스트/제한 환경 대비).
 */

const DB_NAME = 'rhwpStudioGhostComments';
const DB_VER = 1;
const STORE = 'ghosts';

export interface GhostComment {
  id: string;
  /** 문서 식별자 (현재는 파일명) — 문서별로 메모를 갈라 담는다 */
  docKey: string;
  /** 앵커: 엔진 안정 id (세션/문서 혈통 안에서만 유효) */
  stableId: string;
  /** 앵커 폴백: stableId 가 비거나 못 찾을 때 쓰는 좌표 */
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  /** 앵커 폴백 2: 문단 앞머리 텍스트 — 문단이 밀렸을 때 다시 찾기용 */
  textHint: string;
  text: string;
  addedAt: number;
}

const memory = new Map<string, GhostComment>();

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onerror = () => resolve(null);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
  });
}

async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  const db = await openDb();
  if (!db) return fallback();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

export function createGhostId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ghost_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function saveGhost(g: GhostComment): Promise<void> {
  const row: GhostComment = { ...g };
  await withDb(
    async (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(row); // 같은 id → 덮어쓰기
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
    async () => {
      memory.set(row.id, row);
    },
  );
}

/** 한 문서의 고스트 메모 — 오래된 것부터(달아둔 순서대로 읽는 게 자연스럽다) */
export async function listGhosts(docKey: string): Promise<GhostComment[]> {
  const pick = (rows: GhostComment[]): GhostComment[] =>
    rows.filter((r) => r.docKey === docKey).sort((a, b) => a.addedAt - b.addedAt);
  return withDb(
    async (db) =>
      new Promise<GhostComment[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(pick((req.result as GhostComment[]) ?? []));
        req.onerror = () => reject(req.error);
      }),
    async () => pick([...memory.values()]),
  );
}

export async function deleteGhost(id: string): Promise<void> {
  memory.delete(id);
  await withDb(
    async (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
    async () => {},
  );
}

export async function clearGhosts(docKey: string): Promise<number> {
  const rows = await listGhosts(docKey);
  for (const r of rows) await deleteGhost(r.id);
  return rows.length;
}
