/**
 * 사용자 커스텀 문단 템플릿 저장소 (v1).
 *
 * ponytail: 줄 구조 텍스트(body)만 저장한다 — 인라인 서식(굵게·색·글꼴)은 미보존.
 *   충실한 왕복이 필요해지면 레코드에 문서 bytes(Uint8Array)를 얹어 승격하면 된다.
 *   지금은 문자열만이라 autosave-store 의 blob 처리(ArrayBuffer 변환)는 뺐다.
 *
 * autosave-store 와 같은 IndexedDB + 메모리 폴백 패턴(테스트/제한 환경 대비).
 */

import type { WasmBridge } from '@/core/wasm-bridge';

const DB_NAME = 'rhwpStudioTemplates';
const DB_VER = 1;
const STORE = 'templates';

export interface CustomTemplate {
  id: string;
  label: string;
  body: string;
  addedAt: number;
}

const memory = new Map<string, CustomTemplate>();

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

export function createTemplateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function saveTemplate(t: CustomTemplate): Promise<void> {
  const row: CustomTemplate = { ...t };
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

export async function listTemplates(): Promise<CustomTemplate[]> {
  return withDb(
    async (db) =>
      new Promise<CustomTemplate[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
          const rows = (req.result as CustomTemplate[]) ?? [];
          resolve(rows.sort((a, b) => b.addedAt - a.addedAt));
        };
        req.onerror = () => reject(req.error);
      }),
    async () => [...memory.values()].sort((a, b) => b.addedAt - a.addedAt),
  );
}

export async function deleteTemplate(id: string): Promise<void> {
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

/**
 * 현재 문서(섹션 0)의 각 문단 텍스트를 \n 으로 이어 body 문자열로 만든다.
 *
 * ⚠ getParagraphLength 는 **논리 길이**(인라인 컨트롤 각 1칸), getTextRange 는
 *   **텍스트 오프셋**을 받는다. logicalToTextOffset 로 변환하지 않으면 도장·표가 낀
 *   문단에서 글자가 잘리거나 초과한다(ai-doc-insert 가 같은 이유로 변환한다).
 *
 * 뒤쪽 빈 문단은 잘라낸다 — 결과가 비면 빈 문자열.
 */
export function extractDocBody(wasm: WasmBridge): string {
  const sec = 0;
  const count = wasm.getParagraphCount(sec);
  const lines: string[] = [];
  for (let p = 0; p < count; p++) {
    const logicalLen = wasm.getParagraphLength(sec, p);
    const textLen = wasm.logicalToTextOffset(sec, p, logicalLen);
    lines.push(textLen > 0 ? wasm.getTextRange(sec, p, 0, textLen) : '');
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}
