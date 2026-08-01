/**
 * 로컬 사진첩("내 사진") 드롭다운 — 리본 "내 사진" 버튼 클릭 시 표시.
 * 저장된 이미지를 썸네일 그리드로 보여주고, 클릭하면 재삽입한다.
 * 앵커 팝오버 골격은 `shape-picker.ts` 를 따른다.
 */
import { listPhotos, deletePhoto, type PhotoEntry } from '@/media/photo-store';

export interface PhotoPickerOptions {
  onPick: (entry: PhotoEntry) => void;
  onAddFromFile: () => void;
}

let currentPicker: HTMLDivElement | null = null;

function closePicker(): void {
  if (currentPicker) {
    currentPicker.remove();
    currentPicker = null;
  }
  document.removeEventListener('mousedown', onOutsideClick, true);
}

function onOutsideClick(e: MouseEvent): void {
  if (currentPicker && !currentPicker.contains(e.target as Node)) {
    closePicker();
  }
}

function renderTile(entry: PhotoEntry, opts: PhotoPickerOptions, grid: HTMLElement): HTMLElement {
  const tile = document.createElement('button');
  tile.className = 'photo-picker-tile';
  tile.title = entry.name;

  const thumb = document.createElement('span');
  thumb.className = 'photo-picker-thumb';
  if (entry.thumb) {
    const img = document.createElement('img');
    img.src = entry.thumb;
    img.alt = entry.name;
    thumb.appendChild(img);
  } else {
    thumb.textContent = entry.ext.toUpperCase();
    thumb.classList.add('photo-picker-thumb-empty');
  }
  tile.appendChild(thumb);

  const del = document.createElement('span');
  del.className = 'photo-picker-del';
  del.textContent = '×';
  del.title = '사진첩에서 삭제';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    void deletePhoto(entry.id).then(() => {
      tile.remove();
      if (!grid.querySelector('.photo-picker-tile')) renderEmpty(grid);
    });
  });
  tile.appendChild(del);

  tile.addEventListener('click', () => {
    closePicker();
    opts.onPick(entry);
  });
  return tile;
}

function renderEmpty(grid: HTMLElement): void {
  grid.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'photo-picker-empty';
  empty.textContent = '아직 넣은 그림이 없어요. 그림을 삽입하면 여기에 모입니다.';
  grid.appendChild(empty);
}

export function showPhotoPicker(anchorEl: HTMLElement, opts: PhotoPickerOptions): void {
  if (currentPicker) { closePicker(); return; }

  const panel = document.createElement('div');
  panel.className = 'photo-picker';

  // 헤더: 제목 + "파일에서 추가"
  const header = document.createElement('div');
  header.className = 'photo-picker-header';
  const title = document.createElement('span');
  title.className = 'photo-picker-title';
  title.textContent = '내 사진';
  const addBtn = document.createElement('button');
  addBtn.className = 'photo-picker-add';
  addBtn.textContent = '＋ 파일에서 추가';
  addBtn.addEventListener('click', () => {
    closePicker();
    opts.onAddFromFile();
  });
  header.appendChild(title);
  header.appendChild(addBtn);
  panel.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'photo-picker-grid';
  panel.appendChild(grid);

  // 위치 계산 (shape-picker 와 동일) — 화면 밖으로 넘치면 오른쪽 정렬로 보정
  const rect = anchorEl.getBoundingClientRect();
  panel.style.position = 'fixed';
  panel.style.top = `${rect.bottom + 2}px`;
  const PANEL_W = 300;
  const left = Math.min(rect.left, window.innerWidth - PANEL_W - 8);
  panel.style.left = `${Math.max(8, left)}px`;

  document.body.appendChild(panel);
  currentPicker = panel;

  // 비동기 로드 후 그리드 채우기
  void listPhotos().then((photos) => {
    if (currentPicker !== panel) return; // 닫혔으면 무시
    if (!photos.length) { renderEmpty(grid); return; }
    for (const entry of photos) grid.appendChild(renderTile(entry, opts, grid));
  });

  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick, true);
  }, 0);
}
