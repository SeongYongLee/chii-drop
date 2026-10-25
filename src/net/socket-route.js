// 서버는 방 코드만 전달한다. 토큰이나 외부 주소를 URL에 넣지 않는다.
export function roomSocketURL(base, code) {
  const url = new URL(base);
  if (code !== null && (typeof code !== 'string' || !/^[A-F0-9]{8}$/.test(code))) throw new Error('invalid room route');
  if (code === null) url.searchParams.delete('room');
  else url.searchParams.set('room', code);
  return url.href;
}
