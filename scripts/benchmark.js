#!/usr/bin/env node
// Benchmark repository scans: sequential vs concurrent, cold vs cached, and an incremental re-scan.
//
//   npm run compile
//   node scripts/benchmark.js <repo-dir> [<repo-dir> ...] [--runs 3] [--out benchmark/results.json]
//
// For every repository it reports the median of several runs for:
//   sequential   one file at a time, no cache (the previous scanner's behaviour)
//   cold         concurrent scan with an empty cache
//   warm         re-scan with nothing changed
//   incremental  re-scan after editing 5% of the files
// and checks that cached scans return exactly the same detections as an uncached scan.

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CRYPTO_DETECTOR_VERBOSE = '0';
const engine = require('../out/core/scan-engine');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const runs = Number(flag('--runs', 3));
const outFile = flag('--out', path.join(__dirname, '..', 'benchmark', 'results.json'));
const repos = args;
if (repos.length === 0) {
  console.error('usage: node scripts/benchmark.js <repo-dir> [...] [--runs 3] [--out file]');
  process.exit(1);
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fingerprint = assets => JSON.stringify(
  assets.map(a => `${a.name}|${path.relative(process.cwd(), a.source || '')}|${a.line || 0}|${a.occurrences || 1}`).sort()
);

async function timed(fn) {
  const quiet = console.log;
  console.log = () => {};
  const start = process.hrtime.bigint();
  try {
    const result = await fn();
    return { seconds: Number(process.hrtime.bigint() - start) / 1e9, result };
  } finally {
    console.log = quiet;
  }
}

function sourceFiles(dir) {
  const exts = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.py', '.java', '.kt', '.kts', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.go', '.rs', '.php', '.rb'];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', 'venv', '.venv']);
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(full); }
      else if (exts.includes(path.extname(e.name).toLowerCase())) found.push(full);
    }
  })(dir);
  return found.sort();
}

async function benchmark(repo) {
  const root = path.resolve(repo);
  const files = sourceFiles(root);
  const lines = files.reduce((n, f) => n + fs.readFileSync(f, 'utf8').split('\n').length, 0);
  const cacheFile = path.join(os.tmpdir(), `crypto-detector-bench-${process.pid}-${path.basename(root)}.json`);
  const results = { sequential: [], cold: [], warm: [], incremental: [] };

  let reference;
  let cachedMatches = true;
  for (let run = 0; run < runs; run++) {
    const seq = await timed(() => engine.scanFolder(root, { cacheFile: false, concurrency: 1 }));
    results.sequential.push(seq.seconds);
    reference = reference || fingerprint(seq.result);

    fs.rmSync(cacheFile, { force: true });
    const cold = await timed(() => engine.scanFolder(root, { cacheFile, concurrency: 8 }));
    results.cold.push(cold.seconds);

    const warm = await timed(() => engine.scanFolder(root, { cacheFile, concurrency: 8 }));
    results.warm.push(warm.seconds);
    cachedMatches = cachedMatches && fingerprint(cold.result) === reference && fingerprint(warm.result) === reference;

    // Edit 5% of the files (a trailing comment changes size and content), re-scan, then restore them.
    const edited = files.filter((_, i) => i % 20 === 0);
    const originals = edited.map(f => [f, fs.readFileSync(f)]);
    const comment = f => (path.extname(f) === '.py' || path.extname(f) === '.rb' ? '\n# benchmark edit\n' : '\n// benchmark edit\n');
    try {
      edited.forEach(f => fs.appendFileSync(f, comment(f)));
      const inc = await timed(() => engine.scanFolder(root, { cacheFile, concurrency: 8 }));
      results.incremental.push(inc.seconds);
    } finally {
      originals.forEach(([f, data]) => fs.writeFileSync(f, data));
    }
  }
  fs.rmSync(cacheFile, { force: true });

  const m = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, median(v)]));
  const reduction = key => Math.round((1 - m[key] / m.sequential) * 1000) / 10;
  return {
    repository: path.basename(root),
    files: files.length,
    lines,
    runs,
    median_seconds: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    lines_per_second_sequential: Math.round(lines / m.sequential),
    lines_per_second_cold: Math.round(lines / m.cold),
    time_saved_vs_sequential_percent: { cold: reduction('cold'), warm: reduction('warm'), incremental: reduction('incremental') },
    cached_results_identical: cachedMatches,
  };
}

(async () => {
  const report = { node: process.version, cpu: os.cpus()[0].model, results: [] };
  for (const repo of repos) {
    const result = await benchmark(repo);
    report.results.push(result);
    console.log(JSON.stringify(result));
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`Saved ${path.relative(process.cwd(), outFile)}`);
})();
