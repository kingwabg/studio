// parseSheet.ts — 엑셀/CSV 파일 → { columns, rows }. 첫 행이 열 이름(진실).
// SheetJS는 무거워서(수백 KB) 업로드 순간에만 지연 로딩한다.
export interface Dataset {
  name: string; // 파일 이름 (표시용)
  columns: string[]; // 첫 행
  rows: string[][]; // 데이터 행 (columns 길이에 맞춰 정규화)
}

export async function parseSheetFile(file: File): Promise<Dataset> {
  const XLSX = await import("xlsx");
  // CSV는 바이트로 넘기면 SheetJS가 latin1로 읽어 한글이 깨진다 — 텍스트로 직접 디코딩.
  // UTF-8 우선, 깨짐(U+FFFD) 감지 시 EUC-KR 폴백 (한국 엑셀이 저장한 CSV 대응).
  const isCsv = /\.csv$/i.test(file.name);
  const wb = isCsv
    ? XLSX.read(decodeKoreanText(await file.arrayBuffer()), { type: "string" })
    : XLSX.read(await file.arrayBuffer(), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("시트를 찾을 수 없습니다.");
  // header:1 → 2차원 배열, raw:false → 날짜/숫자를 표시 문자열로 (문서에 넣을 값이므로)
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][];
  const header = (aoa[0] ?? []).map((c) => String(c).trim());
  const columns = header.filter(Boolean);
  if (columns.length === 0) throw new Error("첫 행에서 열 이름을 찾지 못했습니다.");
  const rows = aoa
    .slice(1)
    .map((r) => header.map((_, i) => String(r[i] ?? "").trim()).filter((_, i) => header[i] !== ""))
    .filter((r) => r.some((c) => c !== ""));
  if (rows.length === 0) throw new Error("데이터 행이 없습니다. (첫 행은 열 이름으로 사용됩니다)");
  return { name: file.name, columns, rows };
}

function decodeKoreanText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("euc-kr").decode(buf);
  } catch {
    return utf8; // euc-kr 미지원 환경 — utf-8 결과라도 반환
  }
}
