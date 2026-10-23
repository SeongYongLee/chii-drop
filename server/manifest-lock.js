// Serialize editor mutations to a manifest, including independent voice/music editor instances.
const queues = new Map();
export function withManifestLock(file, work) {
  const before = queues.get(file) ?? Promise.resolve();
  const result = before.then(work);
  const tail = result.catch(() => {});
  queues.set(file, tail);
  void tail.then(() => { if (queues.get(file) === tail) queues.delete(file); });
  return result;
}
