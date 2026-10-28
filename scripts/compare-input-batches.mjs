import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { compare } from './compare-state-stream.mjs';

const results = [];
for (const pattern of ['mixed', 'rapid']) for (const network of ['local', 'rtt100-jitter20-spike200', 'rtt220-spike600']) {
  let hash;
  for (const batchPolicy of ['3', '4', 'adaptive6']) {
    const result = await compare('inputs', network, { batchPolicy, pattern });
    hash ??= result.hash;
    assert.equal(result.hash, hash, 'same input and seed must produce the same authoritative game');
    results.push(result); console.log(JSON.stringify(result));
  }
}
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify({ description: 'Two real local WebSocket clients, 600 frames per run, ordered simulated delays; JSON payload only. Storage is measured separately on workerd.', results }, null, 2));
