/**
 * 로컬 사진첩("내 사진") 저장소.
 *
 * 문서에 삽입한 이미지를 브라우저에 모아 재삽입할 수 있게 한다. 자동복구
 * (`rhwpStudioAutosave`)·이력(`rhwpStudioDocHistory`)과 섞지 않으려 별도
 * IndexedDB를 쓴다. IndexedDB를 못 쓰는 테스트/제한 환경에서는 메모리로 폴백한다.
 * 저장 구조·폴백 패턴은 `src/recovery/autosave-store.ts` 를 그대로 따른다.
 *
 * ponytail: 브라우저 IndexedDB 로컬 한정 — 기기간 동기화 없음. 필요해지면
 * 백엔드(로그인+클라우드 스토리지)로 승격.
 */

const DB_NAME = 'rhwpStudioPhotos';
const DB_VER = 1;
const PHOTOS = 'photos';
const MAX_PHOTOS = 60;
const MAX_BYTES = 40 * 1024 * 1024; // 40MB — IndexedDB 무한 증식 방지

export interface PhotoEntry {
  id: string;
  name: string;
  ext: string;
  width: number;
  height: number;
  byteLength: number;
  hash: string;   // 콘텐츠 해시 — 중복 제거 키
  thumb: string;  // 그리드용 축소 dataURL (없으면 '')
  addedAt: number;
  data: Uint8Array;
}

export interface SavePhotoInput {
  name: string;
  ext: string;
  width: number;
  height: number;
  data: Uint8Array;
  thumb?: string;
  addedAt?: number; // 테스트 결정성용; 생략 시 Date.now()
}

type PhotoRow = Omit<PhotoEntry, 'data'> & { data?: ArrayBuffer };

const memory = new Map<string, PhotoEntry>();

/** FNV-1a 32-bit + 길이 — 무의존 중복 제거 키(암호용 아님, dedup 전용). */
function contentHash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${(bytes.length >>> 0).toString(16)}:${(h >>> 0).toString(16)}`;
}

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function cloneEntry(entry: PhotoEntry): PhotoEntry {
  return { ...entry, data: cloneBytes(entry.data) };
}

function rowToEntry(row: PhotoRow): PhotoEntry {
  return { ...row, data: new Uint8Array(row.data ?? new ArrayBuffer(0)) };
}

function entryToRow(entry: PhotoEntry): PhotoRow {
  return { ...entry, data: bytesToArrayBuffer(entry.data) };
}

function openDb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onerror = () => resolve(null);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTOS)) {
        db.createObjectStore(PHOTOS, { keyPath: 'id' });
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

export function createPhotoId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `photo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function putEntry(entry: PhotoEntry): Promise<void> {
  const normalized = cloneEntry(entry);
  await withDb(
    async (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PHOTOS, 'readwrite');
        tx.objectStore(PHOTOS).put(entryToRow(normalized));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
    async () => {
      memory.set(normalized.id, normalized);
    },
  );
}

/** 개수/총바이트 상한 초과 시 addedAt 오래된 것부터 축출 (autosave trim 패턴). */
async function trim(): Promise<void> {
  const all = await listPhotos();
  const sorted = [...all].sort((a, b) => a.addedAt - b.addedAt); // 오래된 순
  let totalBytes = sorted.reduce((sum, p) => sum + p.byteLength, 0);
  let count = sorted.length;
  const doomed: string[] = [];
  for (const p of sorted) {
    if (count <= MAX_PHOTOS && totalBytes <= MAX_BYTES) break;
    doomed.push(p.id);
    totalBytes -= p.byteLength;
    count -= 1;
  }
  for (const id of doomed) await deletePhoto(id);
}

export async function savePhoto(input: SavePhotoInput): Promise<PhotoEntry> {
  const hash = contentHash(input.data);
  const addedAt = input.addedAt ?? Date.now();

  // 중복 제거: 같은 바이트면 새로 쌓지 않고 최근성(addedAt)만 갱신.
  const existing = (await listPhotos()).find((p) => p.hash === hash);
  if (existing) {
    existing.addedAt = addedAt;
    if (input.thumb) existing.thumb = input.thumb;
    await putEntry(existing);
    return existing;
  }

  const entry: PhotoEntry = {
    id: createPhotoId(),
    name: input.name,
    ext: input.ext,
    width: input.width,
    height: input.height,
    byteLength: input.data.byteLength,
    hash,
    thumb: input.thumb ?? '',
    addedAt,
    data: cloneBytes(input.data),
  };
  await putEntry(entry);
  await trim();
  return entry;
}

export async function listPhotos(): Promise<PhotoEntry[]> {
  return withDb(
    async (db) =>
      new Promise<PhotoEntry[]>((resolve, reject) => {
        const tx = db.transaction(PHOTOS, 'readonly');
        const req = tx.objectStore(PHOTOS).getAll();
        req.onsuccess = () => {
          const rows = ((req.result as PhotoRow[]) ?? []).map(rowToEntry);
          resolve(rows.sort((a, b) => b.addedAt - a.addedAt)); // 최신 우선
        };
        req.onerror = () => reject(req.error);
      }),
    async () => [...memory.values()].map(cloneEntry).sort((a, b) => b.addedAt - a.addedAt),
  );
}

export async function getPhoto(id: string): Promise<PhotoEntry | null> {
  const mem = memory.get(id);
  if (mem) return cloneEntry(mem);
  return withDb(
    async (db) =>
      new Promise<PhotoEntry | null>((resolve, reject) => {
        const tx = db.transaction(PHOTOS, 'readonly');
        const req = tx.objectStore(PHOTOS).get(id);
        req.onsuccess = () => {
          const row = req.result as PhotoRow | undefined;
          resolve(row ? rowToEntry(row) : null);
        };
        req.onerror = () => reject(req.error);
      }),
    async () => null,
  );
}

export async function deletePhoto(id: string): Promise<void> {
  memory.delete(id);
  await withDb(
    async (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PHOTOS, 'readwrite');
        tx.objectStore(PHOTOS).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
    async () => {},
  );
}

export async function clearPhotos(): Promise<void> {
  memory.clear();
  await withDb(
    async (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PHOTOS, 'readwrite');
        tx.objectStore(PHOTOS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
    async () => {},
  );
}
