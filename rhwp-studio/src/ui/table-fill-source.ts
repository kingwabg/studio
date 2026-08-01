/**
 * 표 빈칸 채우기 — **첨부 자료 읽기 전담**.
 * 사용자가 고른 엑셀(.xlsx)·CSV 를 격자로 바꿔 프롬프트에 실을 텍스트를 만든다.
 *
 * ⚠ PDF 는 범위 밖이다(사용자 결정 2026-08-01). 파서가 무겁고 텍스트 추출 품질이
 *   들쭉날쭉해서, 잘못 뽑힌 숫자가 표에 들어가면 CSV 를 못 읽는 것보다 나쁘다.
 * ⚠ 여기서 만든 텍스트는 **통째로 외부 LLM 으로 나간다**. 그래서 상한이 셋이다
 *   (바이트·행·글자) — 사용자에게 보여줄 수치도 여기서 같이 돌려준다.
 *
 * 라이브러리를 쓰지 않는다: CSV 는 상태기계 30줄이고, xlsx 압축 해제는 브라우저
 * 기본 기능 DecompressionStream('deflate-raw') 로 된다(SheetJS ~1MB 를 아낀다).
 */

/** 파일 크기 상한 2MB — 이 위는 "표 몇 개"가 아니라 데이터베이스 덤프다.
 *  어차피 아래 글자 상한에서 잘리므로 통째로 메모리에 올릴 이유가 없다. */
export const MAX_BYTES = 2 * 1024 * 1024;
/** 행 상한 — 표 한 장의 근거 자료를 상정한다. 넘으면 앞부분만. */
export const MAX_ROWS = 200;
/** 글자 상한 — 본문 문맥이 이미 4000자를 쓴다. 첨부까지 6000자면
 *  프롬프트 총량이 1만자 남짓(≈5k 토큰)으로 모델 한계 안에 머문다. */
export const MAX_CHARS = 6000;

export interface SourceDoc {
  name: string;
  /** 읽어들인 격자(상한 적용 후) */
  rows: string[][];
  /** 프롬프트에 실을 텍스트 */
  text: string;
  /** 원본 행 수 — 잘렸는지 사용자에게 보여주려고 따로 둔다 */
  totalRows: number;
  truncated: boolean;
}

/* ── CSV ─────────────────────────────────────────────────── */

/** RFC4180 상태기계 — 따옴표 안의 쉼표·줄바꿈·`""` 이스케이프를 지킨다. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') { cur += ch; continue; }
      if (src[i + 1] === '"') { cur += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cur); cur = ''; continue; }
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/** 한국 사무 현장의 CSV 는 아직 CP949 가 흔하다 — UTF-8 로 못 읽으면 넘어간다. */
function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

/* ── XLSX (zip + SpreadsheetML) ──────────────────────────── */

/** zip 안의 파일 하나를 꺼낸다. 저장(0)·deflate(8)만 — xlsx 는 이 둘뿐이다. */
async function unzip(buf: ArrayBuffer): Promise<Map<string, ArrayBuffer>> {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // EOCD(0x06054b50) 를 끝에서 찾는다. 주석이 붙어도 64KB 안에 있다.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip 형식이 아닙니다');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, ArrayBuffer>();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + cmtLen;
    // 로컬 헤더는 이름·extra 길이가 중앙 디렉터리와 다를 수 있어 다시 읽는다.
    const dataAt = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(dataAt, dataAt + compSize);
    if (method === 0) { out.set(name, raw.slice().buffer); continue; }
    if (method !== 8) continue;
    const ds = new DecompressionStream('deflate-raw');
    const blob = new Blob([raw.slice()]).stream().pipeThrough(ds);
    out.set(name, await new Response(blob).arrayBuffer());
  }
  return out;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unxml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(Number(e[1] === 'x' ? `0x${e.slice(2)}` : e.slice(1)));
    return ENT[e] ?? m;
  });
}

/** `<t>` 조각을 모아 문자열 하나로 — 서식이 나뉜 셀은 조각이 여럿이다. */
function textOf(xml: string): string {
  const parts = xml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? [];
  return parts.map((t) => unxml(t.replace(/<[^>]+>/g, ''))).join('').trim();
}

/** 열 이름(A, B, …, AA)을 0부터의 색인으로. */
function colOf(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf);
  const dec = (name: string): string => {
    const f = files.get(name);
    return f ? new TextDecoder().decode(f) : '';
  };
  const shared = (dec('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>|<si\/>/g) ?? []).map(textOf);
  // ponytail: 첫 시트만 읽는다(이름순 최소). 여러 시트를 골라야 하면 workbook.xml 의
  //           sheet 순서 + UI 선택이 필요하다 — 첨부 자료 1장이면 이걸로 충분하다.
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('시트를 찾지 못했습니다');
  const sheet = dec(sheetName);
  const grid = new Map<number, Map<number, string>>();
  let maxCol = 0;
  for (const cell of sheet.match(/<c\s[^>]*\/>|<c\s[^>]*>[\s\S]*?<\/c>/g) ?? []) {
    const ref = /\sr="([A-Z]+)(\d+)"/.exec(cell);
    if (!ref) continue; // r 없는 셀은 위치를 알 수 없다 — 버린다
    const type = /\st="([^"]+)"/.exec(cell)?.[1] ?? 'n';
    const v = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
    let text = '';
    if (type === 's') text = shared[Number(v)] ?? '';
    else if (type === 'inlineStr') text = textOf(cell);
    else text = unxml(v ?? '').trim();
    if (!text) continue;
    const r = Number(ref[2]) - 1;
    const c = colOf(ref[1]);
    if (!grid.has(r)) grid.set(r, new Map());
    grid.get(r)!.set(c, text);
    if (c > maxCol) maxCol = c;
  }
  return [...grid.keys()].sort((a, b) => a - b).map((r) => {
    const line: string[] = [];
    for (let c = 0; c <= maxCol; c++) line.push(grid.get(r)!.get(c) ?? '');
    return line;
  });
}

/* ── 공용 진입점 ─────────────────────────────────────────── */

/** 격자를 프롬프트용 문자열로. 표 격자(gridToPrompt)와 같은 파이프 모양으로 맞춘다. */
export function rowsToText(rows: string[][]): string {
  return rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
}

/** 확장자로 종류를 가른다. 지원 밖이면 이유를 담아 던진다(PDF 를 이름으로 짚어준다). */
export async function readSourceFile(file: File): Promise<SourceDoc> {
  const name = file.name;
  const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
  if (ext === '.pdf') throw new Error('PDF 는 아직 지원하지 않습니다. 엑셀(.xlsx)이나 CSV 로 저장해 주세요.');
  if (ext !== '.csv' && ext !== '.xlsx' && ext !== '.txt') {
    throw new Error(`${ext} 는 읽을 수 없습니다. 엑셀(.xlsx)·CSV 만 됩니다.`);
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`파일이 큽니다(${Math.round(file.size / 1024)}KB). ${MAX_BYTES / 1024 / 1024}MB 이하만 됩니다.`);
  }
  const buf = await file.arrayBuffer();
  const all = ext === '.xlsx' ? await readXlsx(buf) : parseCsv(decodeText(buf));
  if (all.length === 0) throw new Error('내용이 비어 있습니다.');

  let rows = all.slice(0, MAX_ROWS);
  let text = rowsToText(rows);
  // 글자 상한은 행 단위로 자른다 — 줄 중간에서 끊으면 숫자가 반토막 난다.
  while (text.length > MAX_CHARS && rows.length > 1) {
    rows = rows.slice(0, rows.length - 1);
    text = rowsToText(rows);
  }
  return { name, rows, text, totalRows: all.length, truncated: rows.length < all.length };
}
