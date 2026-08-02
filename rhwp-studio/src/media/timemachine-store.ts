/**
 * 문단 타임머신 저장소 (v1) — 문단 하나의 과거 모습들.
 *
 * 문서 전체 되돌리기(Ctrl+Z)나 자동 저장과 달리, **그 문단만** 과거로 돌린다.
 * "_최종, _진짜최종" 파일을 늘리지 않으려는 게 목적.
 *
 * ponytail: 본문 **문단 텍스트만** 담는다 — 표 셀·인라인 서식은 미포함(v2).
 *   레코드에 서식/셀을 얹으면 그대로 확장된다. 저장은 브라우저 로컬(IndexedDB)이라
 *   문서 파일에는 아무것도 안 들어간다.
 *
 * ghost-store 와 같은 IndexedDB + 메모리 폴백 패턴.
 */

const DB_NAME = 'rhwpStudioTimeMachine';
const DB_VER = 1;
const STORE = 'versions';

/** 문단 하나가 가질 수 있는 판 수 — 넘으면 오래된 것부터 버린다 */
const MAX_PER_PARA = 20;
/** 문서 하나가 가질 수 있는 총 판 수 — 저장소가 무한정 자라지 않게 */
const MAX_PER_DOC = 400;

export interface ParaVersion {
  id: string;
  /** 문서 식별자 (현재는 파일명) */
  docKey: string;
  /** 앵커 키 — 같은 문단의 판들을 묶는다 (안정 id 우선, 없으면 앞머리 텍스트) */
  anchorKey: string;
  sectionIndex: number;
  paragraphIndex: number;
  /** 문단 앞머리 — 문단이 밀렸을 때 다시 찾기용 */
  textHint: string;
  /** 그때의 문단 전체 텍스트 */
  text: string;
  savedAt: number;
}

const memory = new Map<string, ParaVersion>();

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

export function createVersionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ver_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function allRows(): Promise<ParaVersion[]> {
  return withDb(
    async (db) =>
      new Promise<ParaVersion[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as ParaVersion[]) ?? []);
        req.onerror = () => reject(req.error);
      }),
    async () => [...memory.values()],
  );
}

async function removeIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) memory.delete(id);
  await withDb(
    async (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const os = tx.objectStore(STORE);
        for (const id of ids) os.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
    async () => {},
  );
}

/**
 * 한 판을 남긴다. **직전 판과 텍스트가 같으면 안 남긴다**(같은 상태를 쌓지 않는다).
 * 반환: 실제로 남겼는지.
 */
export async function saveVersion(v: Omit<ParaVersion, 'id'>): Promise<boolean> {
  const rows = await allRows();
  const mine = rows
    .filter((r) => r.docKey === v.docKey && r.anchorKey === v.anchorKey)
    .sort((a, b) => a.savedAt - b.savedAt);
  if (mine.length > 0 && mine[mine.length - 1].text === v.text) return false;

  const row: ParaVersion = { ...v, id: createVersionId() };
  await withDb(
    async (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
    async () => {
      memory.set(row.id, row);
    },
  );

  // 상한 넘으면 오래된 것부터 버린다 (문단별 → 문서 전체 순)
  const drop: string[] = [];
  if (mine.length + 1 > MAX_PER_PARA) {
    drop.push(...mine.slice(0, mine.length + 1 - MAX_PER_PARA).map((r) => r.id));
  }
  const docRows = rows.filter((r) => r.docKey === v.docKey);
  if (docRows.length + 1 > MAX_PER_DOC) {
    const oldest = docRows
      .filter((r) => !drop.includes(r.id))
      .sort((a, b) => a.savedAt - b.savedAt)
      .slice(0, docRows.length + 1 - MAX_PER_DOC);
    drop.push(...oldest.map((r) => r.id));
  }
  await removeIds(drop);
  return true;
}

/** 한 문단의 판들 — 최신이 앞 */
export async function listVersions(docKey: string, anchorKey: string): Promise<ParaVersion[]> {
  const rows = await allRows();
  return rows
    .filter((r) => r.docKey === docKey && r.anchorKey === anchorKey)
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** 이 문서에서 판이 쌓인 문단 수 */
export async function countTrackedParagraphs(docKey: string): Promise<number> {
  const rows = await allRows();
  return new Set(rows.filter((r) => r.docKey === docKey).map((r) => r.anchorKey)).size;
}

export async function clearVersions(docKey: string): Promise<number> {
  const rows = await allRows();
  const mine = rows.filter((r) => r.docKey === docKey);
  await removeIds(mine.map((r) => r.id));
  return mine.length;
}
