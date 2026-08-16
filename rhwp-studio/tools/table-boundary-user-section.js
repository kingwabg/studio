// 사용자 수동 확인 섹션 — DOM 생성 방식(속성 문자열 이스케이프 불필요), localStorage 저장
const KEY = 'table-boundary-user-checks-v1';
const DEFAULT_ITEMS = [
  '3×3 만들고 마우스 Shift+드래그로 아무 경계나 어긋내기(손맛)',
  '키보드 F5 + Shift+화살표 어긋내기',
  '첫 행 어긋낸 뒤 아래 행 동일 경계 어긋내기(연쇄)',
  '어긋낸 경계를 반대로 끌어 원상 복귀(치유)',
  '어긋내기 ⌘Z 되돌리기 / ⌘Y 재실행',
  '어긋낸 표 저장 → 다시 열어 격자 유지',
  '한컴(웹한글/한글)에서 우리 저장 파일 열어 격자 동일',
  '표 안에 글자 입력한 뒤 그 행 어긋내기(글자 안 잘림)',
  '셀 병합(합치기) 후 병합 주변 경계 어긋내기',
  '어긋낸 상태에서 열 폭 드래그(세로 불변)',
  'F5 블록 이동으로 어긋낸 표 전체 순회',
  '실무 문서(일지 서식 등)에서 표 경계 조작',
];
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } }
function persist(items) { localStorage.setItem(KEY, JSON.stringify(items)); render(items); }
function state() { return load() || DEFAULT_ITEMS.map((t) => ({ t, s: '미확인', m: '' })); }
function render(items) {
  const tb = document.getElementById('userTable');
  while (tb.rows.length > 1) tb.deleteRow(1);
  items.forEach((it, i) => {
    const tr = tb.insertRow();
    // 상태 드롭다운
    const tdS = tr.insertCell();
    const sel = document.createElement('select');
    for (const o of ['미확인', '완성', '안됨', '보류']) {
      const op = document.createElement('option');
      op.textContent = o;
      if (it.s === o) op.selected = true;
      sel.appendChild(op);
    }
    sel.className = 's-' + it.s;
    sel.addEventListener('change', () => { const a = state(); a[i].s = sel.value; persist(a); });
    tdS.appendChild(sel);
    // 항목명 (직접입력 항목은 편집 가능)
    const tdT = tr.insertCell();
    if (it.custom) {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = it.t; inp.placeholder = '확인할 내용을 적으세요…';
      inp.addEventListener('change', () => { const a = state(); a[i].t = inp.value; persist(a); });
      tdT.appendChild(inp);
    } else {
      tdT.textContent = it.t;
    }
    // 메모
    const tdM = tr.insertCell();
    const memo = document.createElement('input');
    memo.type = 'text'; memo.value = it.m || ''; memo.placeholder = '메모…';
    memo.addEventListener('change', () => { const a = state(); a[i].m = memo.value; persist(a); });
    tdM.appendChild(memo);
    // 삭제
    const tdD = tr.insertCell();
    const del = document.createElement('button');
    del.textContent = '✕'; del.title = '삭제';
    del.addEventListener('click', () => { const a = state(); a.splice(i, 1); persist(a); });
    tdD.appendChild(del);
  });
  const done = items.filter((x) => x.s === '완성').length;
  const bad = items.filter((x) => x.s === '안됨').length;
  document.getElementById('userBadge').textContent = `완성 ${done} · 안됨 ${bad} · 전체 ${items.length}`;
}
document.getElementById('btnAdd').addEventListener('click', () => {
  const a = state(); a.push({ t: '', s: '미확인', m: '', custom: true }); persist(a);
});
document.getElementById('btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state(), null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'table-boundary-user-checks.json';
  link.click();
});
document.getElementById('btnReset').addEventListener('click', () => {
  if (confirm('사용자 확인 상태를 모두 초기화할까요?')) { localStorage.removeItem(KEY); location.reload(); }
});
render(state());
