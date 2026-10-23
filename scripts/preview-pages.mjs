import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const root = await realpath('dist');
const prefix = process.env.BASE_PATH ?? '/';
if (!prefix.startsWith('/') || !prefix.endsWith('/') || prefix.includes('..')) throw new Error('BASE_PATH는 /project/처럼 지정하세요.');
const types = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.wav':'audio/wav','.mp3':'audio/mpeg','.md':'text/plain; charset=utf-8' };
const server = createServer(async (req,res) => {
  try {
    const path = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (!path.startsWith(prefix)) throw new Error('outside prefix');
    const file = await realpath(resolve(root, path.slice(prefix.length) || 'index.html'));
    if (!file.startsWith(root + sep)) throw new Error('outside root');
    res.writeHead(200, {'Content-Type':types[extname(file)] ?? 'application/octet-stream','Cache-Control':'no-store'});
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
const port=Number(process.env.PORT ?? 5180);
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(port,'127.0.0.1',()=>console.log(`Pages preview: http://127.0.0.1:${server.address().port}${prefix}`));
