// assets.ts — 이미지 등 바이너리 자산 저장소 (Phase 1: IndexedDB).
//
// 왜 IndexedDB: 문서 JSON은 localStorage(약 5MB)에 살지만 이미지는 몇 장이면 그걸
// 터뜨린다. 블록에는 자산 id만 넣고(직렬화 가벼움), 바이트는 여기 둔다.
// 인터페이스를 얇게 유지 — Phase 2에서 Supabase Storage 구현체로 갈아끼울 자리.
//
// id 형식: "asset_<uuid>". Block.src에 그대로 저장된다.

const DB_NAME = "studio-assets";
const STORE = "assets";

export interface AssetRecord {
  id: string;
  mime: string;
  bytes: ArrayBuffer;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const uid = () =>
  `asset_${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10)}`;

// 파일/블롭 저장 → 자산 id
export async function putAsset(blob: Blob): Promise<string> {
  const db = await openDb();
  const id = uid();
  const bytes = await blob.arrayBuffer();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ id, mime: blob.type || "image/png", bytes } satisfies AssetRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return id;
}

export async function getAsset(id: string): Promise<AssetRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as AssetRecord) ?? null);
    req.onerror = () => reject(req.error);
  });
}

// 화면 렌더용 object URL — 자산당 1회 생성해 캐시 (revoke는 앱 수명과 함께)
const urlCache = new Map<string, string>();
export async function getAssetUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const rec = await getAsset(id);
  if (!rec) return null;
  const url = URL.createObjectURL(new Blob([rec.bytes], { type: rec.mime }));
  urlCache.set(id, url);
  return url;
}

// data URL(레거시/외부 문서의 src 폴백)을 자산으로 승격
export async function putDataUrl(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl);
  return putAsset(await res.blob());
}

// mime → HWPX BinData 확장자
export function extOfMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("bmp")) return "bmp";
  return "png";
}
