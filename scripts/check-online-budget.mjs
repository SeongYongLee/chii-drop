import { createInputBatcher } from '../src/net/input-batch.js';

// 입력 패턴별 모델이며 실제 사용자의 조작이나 Cloudflare 계정 계측값은 아니다.
const frames = 60 * 60;
const patterns = {
  idle: () => 0,
  held: f => Math.floor(f / 60) % 2 ? 0 : 2,
  mixed: f => (f % 41 < 15 ? 2 : 0) | (f % 53 === 0 ? 8 : 0),
  changingEveryFrame: f => f % 2 ? 1 : 2,
};
for (const [pattern, read] of Object.entries(patterns)) {
  const batcher = createInputBatcher();
  let messages = 0, bytes = 0;
  const count = batch => {
    if (!batch) return;
    messages++; bytes += Buffer.byteLength(JSON.stringify({ ...batch, matchId: '0'.repeat(36), epoch: 0 }));
  };
  for (let f = 0; f < frames; f++) count(batcher.push(f, read(f)));
  count(batcher.flush());
  const hourlyRequests = (messages / 60 * 2 + 2) * 3600 / 20;
  console.log(JSON.stringify({ pattern, sampleSeconds: 60, messagesPerClient: messages,
    messageReductionPercent: +(100 * (1 - messages / frames)).toFixed(1),
    jsonBytesPerClient: bytes,
    hourlyRoomRequestsIncludingHeartbeat: Math.ceil(hourlyRequests),
    requestOnlyRoomHoursPerDay: +(100000 / hourlyRequests).toFixed(2) }));
}
console.log('요청 한도만의 모델: 연결·로비·RPC·알람·랭킹·저장·실행 시간은 별도. 변경이 잦으면 절감 없음.');
