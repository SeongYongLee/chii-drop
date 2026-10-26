import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoomCode, roomInviteCode, roomInviteURL } from '../src/net/room-invite.js';

test('초대 링크는 Pages 하위 경로를 유지하고 방 코드만 포함한다', () => {
  const invite = roomInviteURL('https://example.com/game/index.html?token=secret&password=hidden#new-room', 'a1b2c3d4');
  assert.equal(invite, 'https://example.com/game/index.html?room=A1B2C3D4#play');
  assert.equal(roomInviteCode(invite), 'A1B2C3D4');
});

test('로컬 초대는 테스트 진입을 보존하고 외부 주소에서는 테스트 매개변수를 제외한다', () => {
  assert.equal(roomInviteURL('http://localhost:5180/?multiplayer-test=1&story-test=menu#play', '1234abcd'),
    'http://localhost:5180/index.html?multiplayer-test=1&room=1234ABCD#play');
  assert.equal(new URL(roomInviteURL('https://example.com/?multiplayer-test=1', '1234abcd')).searchParams.has('multiplayer-test'), false);
});

test('잘못된 방 코드는 참가하지 않고, 링크에 인증 정보를 보존하지 않는다', () => {
  for (const value of [undefined, '', '123', 'A1B2C3D4E', '../room', '<script>', ['A1B2C3D4']]) {
    assert.equal(normalizeRoomCode(value), null);
    assert.throws(() => roomInviteURL('https://example.com/', value));
  }
  assert.equal(roomInviteCode('invalid'), null);
  assert.equal(roomInviteCode('https://example.com/?room=bad'), null);
  const link = roomInviteURL('https://name:secret@example.com/game/', 'A1B2C3D4');
  assert.equal(link, 'https://example.com/game/index.html?room=A1B2C3D4#play');
  assert.throws(() => roomInviteURL('file:///tmp/index.html', 'A1B2C3D4'));
});
