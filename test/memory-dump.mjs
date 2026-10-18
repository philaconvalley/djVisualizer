/* Chrome memory-infra dumps for the soak driver — PHI-268.
 *
 * The footprint per process says which process grows. It does not say what
 * inside the process grows. A memory-infra dump does: Chrome splits each
 * process into named pools (malloc, partition_alloc, skia, gpu, cc, v8,
 * blink_gc, ...), the same view chrome://tracing shows.
 *
 * dump(browserCdp) runs one short trace with only the memory-infra category,
 * requests one detailed dump, and returns a summary:
 *
 *   { processes: [{ pid, label, pools: { skia: bytes, ... }, detail: { 'skia/sk_glyph_cache': bytes, ... } }] }
 *
 * Pools are top-level allocator names. Detail goes two levels down, which is
 * enough to tell glyph caches from textures. Sizes are effective_size where
 * Chrome reports it, so memory two pools share is counted once.
 *
 * compare(a, b) returns the rows that grew between two dumps, largest first.
 */

const CATEGORY = 'disabled-by-default-memory-infra';

function bytes(attr) {
  if (!attr || attr.units !== 'bytes') return null;
  return parseInt(attr.value, 16);
}

export async function dump(cdp) {
  const events = [];
  const onData = ({ value }) => events.push(...value);
  cdp.on('Tracing.dataCollected', onData);
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: [CATEGORY], excludedCategories: ['*'] },
    transferMode: 'ReportEvents'
  });
  // deterministic forces a GC first, so garbage does not read as growth.
  const res = await cdp.send('Tracing.requestMemoryDump', {
    deterministic: true,
    levelOfDetail: 'detailed'
  });
  await cdp.send('Tracing.end');
  await done;
  cdp.off('Tracing.dataCollected', onData);
  if (!res.success) throw new Error('memory dump failed');

  const labels = {};
  for (const e of events)
    if (e.ph === 'M' && (e.name === 'process_name' || e.name === 'process_labels'))
      labels[e.pid] = [labels[e.pid], e.args.name || e.args.labels].filter(Boolean).join(' ');

  const byPid = {};
  for (const e of events) {
    const allocators = e.ph === 'v' && e.args?.dumps?.allocators;
    if (!allocators) continue;
    const p = (byPid[e.pid] ??= { pid: e.pid, label: labels[e.pid] || '', pools: {}, detail: {} });
    for (const [name, a] of Object.entries(allocators)) {
      const size = bytes(a.attrs?.effective_size) ?? bytes(a.attrs?.size);
      if (size == null) continue;
      const depth = name.split('/').length;
      if (depth === 1) p.pools[name] = size;
      if (depth === 2) p.detail[name] = size;
    }
  }
  return { processes: Object.values(byPid) };
}

export function compare(a, b) {
  const rows = [];
  for (const pb of b.processes) {
    const pa = a.processes.find((p) => p.pid === pb.pid);
    if (!pa) continue;
    for (const kind of ['pools', 'detail'])
      for (const [name, size] of Object.entries(pb[kind])) {
        const before = pa[kind][name] ?? 0;
        if (size !== before)
          rows.push({ pid: pb.pid, label: pb.label, kind, name, before, after: size });
      }
  }
  return rows.sort((x, y) => y.after - y.before - (x.after - x.before));
}
