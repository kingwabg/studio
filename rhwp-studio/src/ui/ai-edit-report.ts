/** [캔버스 한컴 포크] AI 도구 응답·화면에 공용으로 사용하는 유효한 JSON 적용 로그 요약. */
/** 화면·접근성 트리는 짧게 유지하고 원본 로그는 다운로드에 그대로 보존한다. */
export function summarizeEditReport(report: unknown, maxChars = 16_000): string {
  const full = JSON.stringify(report, null, 2);
  if (full.length <= maxChars) return full;
  const r = report as Record<string, any>;
  const brief = (value: any, depth = 0): any => {
    if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '…' : value;
    if (!value || typeof value !== 'object') return value;
    if (depth >= 3) return '[상세 생략]';
    if (Array.isArray(value)) return value.slice(0, 8).map((item) => brief(item, depth + 1));
    return Object.fromEntries(Object.entries(value).slice(0, 24).map(([key, item]) => [key, brief(item, depth + 1)]));
  };
  const logs = (Array.isArray(r.logs) ? r.logs : []).map((entry: Record<string, any>) => {
    const actual = entry.actual && typeof entry.actual === 'object' ? entry.actual : {};
    const values: Record<string, unknown> = {};
    for (const key of ['pageCount', 'page', 'styleId', 'table', 'bboxPx', 'address', 'text', 'char', 'para', 'style']) {
      if (key in actual) values[key] = brief(actual[key]);
    }
    if (typeof actual.text === 'string') values.textChars = actual.text.length;
    if (Array.isArray(actual.cells)) values.cells = actual.cells.length;
    if (Array.isArray(actual.tables)) values.tables = actual.tables.length;
    if (actual.actual) values.styleProperties = brief(actual.actual);
    return { index: entry.index, tool: entry.tool, status: entry.status, actual: values };
  });
  const summary = {
    ok: r.ok, error: brief(r.error), rolledBack: r.rolledBack, summary: true,
    note: '화면에는 적용값 요약을 표시합니다. 전체 요청·적용값은 적용 로그 저장으로 확인하세요.',
    totalOperations: logs.length, omittedOperations: 0, logs,
  };
  let json = JSON.stringify(summary, null, 2);
  while (json.length > maxChars && logs.length) {
    // 마지막 inspect 결과는 우선 보존하고, 생략 개수를 명시한다.
    logs.splice(logs.length > 1 ? Math.floor((logs.length - 1) / 2) : 0, 1);
    summary.omittedOperations++;
    json = JSON.stringify(summary, null, 2);
  }
  return json;
}
