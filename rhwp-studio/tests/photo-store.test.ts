import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearPhotos,
  deletePhoto,
  listPhotos,
  savePhoto,
} from '../src/media/photo-store.ts';

// IndexedDB 없는 node 환경 → 메모리 폴백 경로를 검증한다.

test('같은 바이트는 중복 저장하지 않고 최근성만 갱신한다', async () => {
  await clearPhotos();
  const data = new Uint8Array([1, 2, 3, 4]);

  const a = await savePhoto({ name: 'a.png', ext: 'png', width: 10, height: 10, data, addedAt: 100 });
  const b = await savePhoto({ name: 'b.png', ext: 'png', width: 10, height: 10, data, addedAt: 200 });

  assert.equal(a.id, b.id, '동일 해시는 같은 엔트리');
  const list = await listPhotos();
  assert.equal(list.length, 1, '중복 제거');
  assert.equal(list[0].addedAt, 200, 'addedAt 갱신됨');

  await clearPhotos();
});

test('MAX_PHOTOS(60) 초과 시 가장 오래된 것부터 축출된다', async () => {
  await clearPhotos();

  for (let i = 0; i < 61; i++) {
    // 서로 다른 바이트 → 서로 다른 해시
    await savePhoto({ name: `p${i}.png`, ext: 'png', width: 1, height: 1, data: new Uint8Array([i]), addedAt: i });
  }

  const list = await listPhotos();
  assert.equal(list.length, 60, '상한 60 유지');
  assert.ok(!list.some((p) => p.addedAt === 0), '가장 오래된 항목 축출됨');
  assert.ok(list.some((p) => p.addedAt === 60), '최신 항목은 남음');

  await clearPhotos();
});

test('삭제하면 목록에서 빠진다', async () => {
  await clearPhotos();
  const saved = await savePhoto({ name: 'x.png', ext: 'png', width: 5, height: 5, data: new Uint8Array([9, 9]), addedAt: 1 });
  await deletePhoto(saved.id);
  assert.equal((await listPhotos()).length, 0);
});
