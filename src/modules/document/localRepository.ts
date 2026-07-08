// localRepository.ts — DocumentRepository의 localStorage 구현.
// Supabase 프로젝트 준비 전 실제 동작(새로고침 유지)을 제공한다. 인터페이스가 같으므로
// 나중에 supabaseRepository로 교체해도 앱(store·routes)은 그대로다.
import { type CanvasDoc, createDoc } from "./model";
import { type DocMeta, type DocumentRepository } from "./repository";

const INDEX_KEY = "studio:index"; // DocMeta[]
const docKey = (id: string) => `studio:doc:${id}`;

// Date.now는 순수 로직엔 없지만, 저장 타임스탬프는 브라우저에서만 찍히므로 여기선 허용.
const now = () => Date.now();

function readIndex(): DocMeta[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeIndex(list: DocMeta[]) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

// 인덱스에서 이 문서의 meta를 최신값으로 교체하고 최근순 정렬.
function upsertMeta(meta: DocMeta) {
  const list = readIndex().filter((m) => m.id !== meta.id);
  list.unshift(meta);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  writeIndex(list);
}

export const localRepository: DocumentRepository = {
  async list() {
    return readIndex();
  },

  async get(id) {
    const raw = localStorage.getItem(docKey(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CanvasDoc;
    } catch {
      return null;
    }
  },

  async create(title) {
    const doc = createDoc(title);
    await this.save(doc);
    return doc;
  },

  async save(doc) {
    localStorage.setItem(docKey(doc.id), JSON.stringify(doc));
    upsertMeta({ id: doc.id, title: doc.title, surface: "canvas", updatedAt: now() });
  },

  async remove(id) {
    localStorage.removeItem(docKey(id));
    writeIndex(readIndex().filter((m) => m.id !== id));
  },
};
