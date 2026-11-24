// src/core/scan-engine.ts - FIXED to use improved parser module
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import simpleGit from 'simple-git';

// Import the improved parser module
import { CryptoAsset } from '../parser/types';
import { analyzeSource } from '../parser/analyze-source';
import { getQuantumAlternativeSuggestion } from '../parser/quantum-alternatives';
import { createCbomDocument } from '../parser/cbom';
import { assignRisk as assessCryptoRisk } from '../parser/risk-utils';
import { ScanCache, analysisVersion } from './scan-cache';

/* ----------------------- Types ----------------------- */
export { CryptoAsset };

/* ----------------------- Helpers ----------------------- */

/**
 * Cross-platform opener for HTML / file paths.
 */
export function openInBrowser(target: string): void {
  const platform = os.platform();
  let command: string;
  let args: string[];

  switch (platform) {
    case 'darwin':
      command = 'open';
      args = [target];
      break;
    case 'win32':
      command = 'cmd.exe';
      args = ['/c', 'start', '', target];
      break;
    default:
      command = 'xdg-open';
      args = [target];
      break;
  }

  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch (err) {
    console.warn('[openInBrowser] Failed to open browser:', err);
  }
}

/* ----------------------- Risk assignment ----------------------- */
export function assignRisk(
  quantumSafe: boolean | 'partial' | 'unknown' | undefined,
  type?: string,
  name?: string
): { severity: string; explanation: string } {
  const { severity, explanation } = assessCryptoRisk(quantumSafe, type, name);
  return { severity, explanation };
}

/* ----------------------- Utilities ----------------------- */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeHtml(s: any): string {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[m]);
}

/** Accept only a public github.com owner/repository URL before starting a clone. */
export function normalizeGithubRepoUrl(input: string): string {
  const trimmed = input.trim();
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Enter a valid GitHub repository URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com' || parsed.username || parsed.password) {
    throw new Error('Use an HTTPS URL on github.com.');
  }
  if (parsed.search || parsed.hash) throw new Error('Use a repository URL without a query or fragment.');

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) throw new Error('Use a repository URL in the form github.com/owner/repository.');
  const owner = decodeURIComponent(segments[0]);
  const repository = decodeURIComponent(segments[1]).replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('The owner or repository name contains unsupported characters.');
  }
  return `https://github.com/${owner}/${repository}.git`;
}

/* ----------------------- scanFile using improved detector ----------------------- */
const VERBOSE = process.env.CRYPTO_DETECTOR_VERBOSE === '1';
const EXCLUDED_EXTS = ['.json', '.xml', '.md', '.txt', '.pdf', '.png', '.jpg', '.gif', '.svg', '.zip', '.tar', '.gz', '.lock', '.log', '.min.js', '.map'];
const EXCLUDED_PATTERNS = ['cbom', 'package-lock', 'yarn.lock', '.min.', 'bundle', 'vendor'];
const CODE_EXTS = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.py', '.java', '.kt', '.kts', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.go', '.rs', '.php', '.rb'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', 'venv', '.venv']);

function isExcluded(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath).toLowerCase();
  return EXCLUDED_EXTS.includes(ext) || EXCLUDED_PATTERNS.some(p => filename.includes(p));
}

export async function scanFile(filePath: string): Promise<CryptoAsset[]> {
  try {
    if (isExcluded(filePath)) {
      return [];
    }
    const content = await fs.readFile(filePath, 'utf8');
    if (!content || content.trim().length === 0) {
      return [];
    }
    // CLI and extension repository scans share the same syntax + text analysis pipeline.
    const results = await analyzeSource(content, filePath);
    if (VERBOSE && results.length > 0) {
      console.log(`[scanFile] Found ${results.length} detection(s) in ${path.basename(filePath)}`);
    }
    return results;
  } catch (err) {
    console.error(`[scanFile] Error scanning ${filePath}:`, err);
    return [];
  }
}

/* ----------------------- scanFolder (recursive, concurrent, cached) ----------------------- */
export interface ScanFolderOptions {
  /** Path of the persistent result cache, or false to disable caching. Defaults to ~/.cache/crypto-detector. */
  cacheFile?: string | false;
  /** Files read and analysed at the same time. */
  concurrency?: number;
  /** Called after each file with the number of files processed so far. */
  onProgress?: (processed: number, total: number) => void;
}

export interface ScanStats {
  files: number;
  lines: number;
  cacheHits: number;
  cacheMisses: number;
  seconds: number;
}

export let lastScanStats: ScanStats | undefined;

async function listSourceFiles(dir: string): Promise<string[]> {
  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.map(async entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : listSourceFiles(full);
    }
    return entry.isFile() && CODE_EXTS.includes(path.extname(entry.name).toLowerCase()) && !isExcluded(full) ? [full] : [];
  }));
  return nested.flat().sort();
}

export async function scanFolder(root: string, options: ScanFolderOptions = {}): Promise<CryptoAsset[]> {
  const started = Date.now();
  const codeFiles = await listSourceFiles(root);
  const cacheFile = options.cacheFile === undefined ? ScanCache.defaultPath(root) : options.cacheFile;
  const cache = cacheFile ? await ScanCache.open(cacheFile, analysisVersion()) : undefined;
  const concurrency = Math.max(1, options.concurrency ?? 8);
  console.log(`[scanFolder] Scanning ${codeFiles.length} source files in ${root}${cache ? ' (cached)' : ''}`);

  // Results are stored by file index and merged in order, so output matches a sequential scan.
  const perFile: CryptoAsset[][] = new Array(codeFiles.length);
  let next = 0;
  let processed = 0;
  let lines = 0;

  async function worker(): Promise<void> {
    while (next < codeFiles.length) {
      const index = next++;
      const file = codeFiles[index];
      try {
        const stat = await fs.stat(file);
        let assets = cache?.byStat(file, stat);
        if (!assets) {
          const content = await fs.readFile(file, 'utf8');
          lines += content.split('\n').length;
          const hash = cache ? ScanCache.hash(content) : '';
          assets = cache?.byHash(file, hash, stat);
          if (!assets) {
            assets = content.trim() ? await analyzeSource(content, file) : [];
            cache?.store(file, stat, hash, assets);
          }
        }
        perFile[index] = assets;
      } catch (err) {
        console.warn(`[scanFolder] Error scanning ${file}:`, err);
        perFile[index] = [];
      }
      processed++;
      options.onProgress?.(processed, codeFiles.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, codeFiles.length || 1) }, worker));

  if (cache) {
    cache.retainOnly(codeFiles);
    await cache.save();
  }

  const assetMap = new Map<string, CryptoAsset>();
  for (const assets of perFile) {
    for (const original of assets || []) {
      const asset = { ...original };
      const key = `${asset.name}:${asset.source}:${asset.line || 0}`;
      const existing = assetMap.get(key);
      if (existing) {
        existing.occurrences = (existing.occurrences || 1) + 1;
        if (asset.detectionContexts) {
          existing.detectionContexts = [...(existing.detectionContexts || []), ...asset.detectionContexts];
        }
      } else {
        assetMap.set(key, asset);
      }
    }
  }
  const deduplicated = Array.from(assetMap.values());

  lastScanStats = {
    files: codeFiles.length,
    lines,
    cacheHits: cache?.hits ?? 0,
    cacheMisses: cache ? cache.misses : codeFiles.length,
    seconds: (Date.now() - started) / 1000,
  };
  console.log(`[scanFolder] Done in ${lastScanStats.seconds.toFixed(2)}s: ${codeFiles.length} files, ` +
    `${deduplicated.length} unique detections` +
    (cache ? `, ${cache.hits} reused from cache, ${cache.misses} analysed` : ''));
  return deduplicated;
}

/* ----------------------- scanGithubRepo (long-path safe) ----------------------- */
export async function scanGithubRepo(
  repoUrl: string,
  outputDir: string
): Promise<{
  codeFiles: number;
  detections: number;
  cbomPath: string;
  dashboardPath: string;
}> {
  console.log(`\n📥 [GitHub] Cloning repository: ${repoUrl}`);

  const normalizedUrl = normalizeGithubRepoUrl(repoUrl);

  const repoName = normalizedUrl.split('/').pop()?.replace('.git', '') ?? 'repo';
  
  // Pick short directory for Windows long-path issues
  let targetDir: string;
  if (process.platform === 'win32' && fsSync.existsSync('C:\\r')) {
    targetDir = path.join('C:\\r', `cd-${Date.now()}`);
  } else if (process.platform === 'win32') {
    targetDir = path.join('C:\\', `cd-${Date.now()}`);
  } else {
    targetDir = path.join(os.tmpdir(), `crypto-detector-${repoName}-${Date.now()}`);
  }

  fsSync.mkdirSync(targetDir, { recursive: true });
  console.log(`📁 [GitHub] Target directory: ${targetDir}`);

  const git = simpleGit();

  // Try shallow clone first
  try {
    console.log(`⬇️  [GitHub] Attempting shallow clone...`);
    await git.clone(normalizedUrl, targetDir, [
      '--config', 'core.longpaths=true',
      '--depth', '1'
    ]);
    console.log(`✅ [GitHub] Shallow clone succeeded`);
  } catch (err) {
    console.warn('⚠️  [GitHub] Shallow clone failed, trying full clone...');
    try {
      await git.clone(normalizedUrl, targetDir, [
        '--config', 'core.longpaths=true'
      ]);
      console.log('✅ [GitHub] Full clone succeeded');
    } catch (err2) {
      console.error('❌ [GitHub] Clone failed:', err2);
      fsSync.rmSync(targetDir, { recursive: true, force: true });
      throw new Error(`Failed to clone repository: ${err2}`);
    }
  }

  try {
  // Scan the cloned repository
  console.log(`\n🔍 [GitHub] Scanning cloned repository...`);
  const allAssets = await scanFolder(targetDir, { cacheFile: false }); // temporary clone: nothing to reuse later

  // Count code files
  function countCodeFiles(dir: string): number {
    let count = 0;
    try {
      const entries = fsSync.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (full.includes('node_modules') || full.includes('.git')) continue;
        
        if (entry.isDirectory()) {
          count += countCodeFiles(full);
        } else if (entry.isFile()) {
          const ext = path.extname(full).toLowerCase();
          if (['.js', '.jsx', '.mjs', '.ts', '.tsx', '.py', '.java', '.kt', '.kts', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.go', '.rs', '.php', '.rb'].includes(ext)) {
            count++;
          }
        }
      }
    } catch {}
    return count;
  }

  const codeFileCount = countCodeFiles(targetDir);

  // Generate output files
  fsSync.mkdirSync(outputDir, { recursive: true });

  const cbomPath = path.join(outputDir, `${repoName}-cbom.json`);
  await generateCBOM(allAssets, cbomPath, targetDir);
  console.log(`📦 [GitHub] CBOM saved: ${cbomPath}`);

  const dashboardPath = path.join(outputDir, `${repoName}-dashboard.html`);
  generateDashboardHtml(allAssets, dashboardPath);
  console.log(`📊 [GitHub] Dashboard saved: ${dashboardPath}`);

  return {
    codeFiles: codeFileCount,
    detections: allAssets.length,
    cbomPath,
    dashboardPath
  };
  } finally {
    fsSync.rmSync(targetDir, { recursive: true, force: true });
    console.log('🧹 [GitHub] Cleaned up temporary clone');
  }
}

/* ----------------------- generateCBOM ----------------------- */
export async function generateCBOM(assets: CryptoAsset[], outputPath: string, sourceRoot?: string): Promise<void> {
  const cbom = createCbomDocument(assets, sourceRoot);
  await fs.writeFile(outputPath, JSON.stringify(cbom, null, 2), "utf8");
}

/* ----------------------- generateDashboardHtml ----------------------- */
// src/core/scan-engine.ts - Enhanced generateDashboardHtml with file grouping

export function generateDashboardHtml(assets: CryptoAsset[], outputPath: string): void {
  type DashboardRow = {
    asset: CryptoAsset;
    file: string;
    line: number;
  };

  // Group normalized rows by file and deduplicate by (file, line, algorithm)
  const byFile: Record<string, DashboardRow[]> = {};
  const seenRows = new Set<string>();

  for (const asset of assets) {
    const contexts = asset.detectionContexts ?? [];

    // Build rows from detailed contexts when available
    if (contexts.length > 0) {
      for (const ctx of contexts) {
        const file = ctx.filePath || asset.source || 'Unknown';
        const lineNumbers = ctx.lineNumbers && ctx.lineNumbers.length > 0
          ? ctx.lineNumbers
          : [asset.line || 0];

        for (const line of lineNumbers) {
          const key = `${file}::${line}::${asset.name}`;
          if (seenRows.has(key)) continue;
          seenRows.add(key);

          if (!byFile[file]) byFile[file] = [];
          byFile[file].push({ asset, file, line });
        }
      }
      continue;
    }

    // Fallback for detectors that only provide source/line
    const file = asset.source || 'Unknown';
    const line = asset.line || 0;
    const key = `${file}::${line}::${asset.name}`;
    if (seenRows.has(key)) continue;
    seenRows.add(key);

    if (!byFile[file]) byFile[file] = [];
    byFile[file].push({ asset, file, line });
  }

  const files = Object.keys(byFile).sort();
  const total = assets.reduce((sum, asset) => sum + (asset.occurrences ?? 1), 0);
  const high = assets.filter(a => String(a.severity).toLowerCase() === 'high').length;
  const medium = assets.filter(a => String(a.severity).toLowerCase() === 'medium').length;
  const low = assets.filter(a => String(a.severity).toLowerCase() === 'low').length;
  const qSafe = assets.filter(a => a.quantumImpact === 'post-quantum' || a.quantumSafe === true).length;
  const qVuln = assets.filter(a => a.quantumImpact === 'vulnerable' || a.quantumSafe === false).length;
  const qReduced = assets.filter(a => a.quantumImpact === 'reduced-strength' || a.quantumSafe === 'partial').length;

  // Build file sections HTML
  let fileSectionsHtml = '';
  for (const file of files) {
    const filename = path.basename(file);
    const fileRows = byFile[file];
    
    fileSectionsHtml += `
      <div class="file-section">
        <div class="file-header" onclick="toggleFile(this)">
          <span class="file-icon">📄</span>
          <span class="file-name">${escapeHtml(filename)}</span>
          <span class="file-count">${fileRows.length} detection(s)</span>
          <span class="toggle-icon">▼</span>
        </div>
        <div class="file-content">
          <div class="file-path">${escapeHtml(file)}</div>
          <table class="file-table">
            <thead>
              <tr>
                <th>Line</th>
                <th>Algorithm</th>
                <th>Type</th>
                <th>Quantum Impact</th>
                <th>Classical Security</th>
                <th>Severity</th>
                <th>Detection</th>
                <th>Calls</th>
                <th>Suggested Alternative</th>
                <th>Suggestion Basis</th>
              </tr>
            </thead>
            <tbody>
    `;

    // Sort by line number
    const sortedRows = [...fileRows].sort((a, b) => {
      return a.line - b.line;
    });

    for (const row of sortedRows) {
      const asset = row.asset;
      const lineStr = String(row.line || 0);

      const suggestion = getQuantumAlternativeSuggestion(asset);
      fileSectionsHtml += `
        <tr class="severity-${escapeHtml(String(asset.severity || 'unknown'))}">
          <td class="line-number">${lineStr}</td>
          <td><strong>${escapeHtml(asset.name)}</strong></td>
          <td>${escapeHtml(asset.primitive || asset.type || 'unknown')}</td>
          <td><span class="quantum-badge quantum-${escapeHtml(String(asset.quantumSafe))}">${escapeHtml(String(asset.quantumImpact ?? asset.quantumSafe ?? 'unknown'))}</span></td>
          <td>${escapeHtml(String(asset.classicalSecurityStatus ?? 'unknown'))}</td>
          <td><span class="severity-badge">${escapeHtml(String(asset.severity || 'unknown').toUpperCase())}</span></td>
          <td>${escapeHtml(`${asset.confidence ?? 'unknown'} · ${asset.detectionMethod ?? 'unspecified'}`)}</td>
          <td>${escapeHtml(String(asset.occurrences ?? 1))}</td>
          <td>${escapeHtml(suggestion.alternative)}</td>
          <td>${escapeHtml(suggestion.rationale)}</td>
        </tr>
      `;
    }

    fileSectionsHtml += `
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Crypto Analysis Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { 
      --bg:#0d1117; 
      --card:#161b22; 
      --text:#e6edf3; 
      --border:#30363d; 
      --accent:#58a6ff;
      --high:#f85149;
      --medium:#f0ad4e;
      --low:#3fb950;
    }
    * { box-sizing: border-box; }
    body { 
      margin:0; 
      font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; 
      background:var(--bg); 
      color:var(--text); 
      padding:24px; 
    }
    .container { max-width:1400px; margin:0 auto; }
    
    h1 { 
      color:var(--accent); 
      margin-bottom:8px; 
      font-size: 2rem;
    }
    
    .subtitle {
      color:#8b949e;
      margin-bottom:24px;
      font-size:0.9rem;
    }
    
    .stats { 
      display:grid; 
      grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); 
      gap:16px; 
      margin:24px 0; 
    }
    
    .stat { 
      background:var(--card); 
      border:1px solid var(--border); 
      border-radius:8px; 
      padding:20px; 
      text-align:center; 
    }
    
    .stat .num { 
      font-size:36px; 
      font-weight:700; 
      color:var(--accent); 
    }
    
    .stat .label { 
      color:#8b949e; 
      margin-top:8px; 
      font-size:14px; 
    }
    
    .stat.high .num { color:var(--high); }
    .stat.medium .num { color:var(--medium); }
    .stat.low .num { color:var(--low); }
    
    .file-section {
      background:var(--card);
      border:1px solid var(--border);
      border-radius:8px;
      margin-bottom:16px;
      overflow:hidden;
    }
    
    .file-header {
      padding:16px 20px;
      cursor:pointer;
      display:flex;
      align-items:center;
      gap:12px;
      transition:background 0.2s;
      user-select:none;
    }
    
    .file-header:hover {
      background:rgba(255,255,255,0.03);
    }
    
    .file-icon {
      font-size:1.2rem;
    }
    
    .file-name {
      font-weight:600;
      flex:1;
      color:var(--accent);
    }
    
    .file-count {
      color:#8b949e;
      font-size:0.9rem;
    }
    
    .toggle-icon {
      color:#8b949e;
      transition:transform 0.2s;
    }
    
    .file-header.collapsed .toggle-icon {
      transform:rotate(-90deg);
    }
    
    .file-content {
      max-height:2000px;
      overflow:hidden;
      transition:max-height 0.3s ease-out;
    }
    
    .file-content.collapsed {
      max-height:0;
    }
    
    .file-path {
      padding:8px 20px;
      font-size:0.85rem;
      color:#8b949e;
      font-family:monospace;
      background:rgba(0,0,0,0.2);
      border-bottom:1px solid var(--border);
    }
    
    .file-table {
      width:100%;
      border-collapse:collapse;
    }
    
    .file-table thead {
      background:#21262d;
      position:sticky;
      top:0;
    }
    
    .file-table th {
      padding:10px 16px;
      text-align:left;
      font-weight:600;
      font-size:0.85rem;
      color:var(--accent);
      border-bottom:2px solid var(--border);
    }
    
    .file-table td {
      padding:10px 16px;
      border-bottom:1px solid var(--border);
      font-size:0.9rem;
    }
    
    .file-table tr:hover {
      background:rgba(255,255,255,0.02);
    }
    
    .line-number {
      font-family:monospace;
      color:#8b949e;
      font-weight:600;
      min-width:60px;
    }
    
    .severity-badge {
      display:inline-block;
      padding:3px 8px;
      border-radius:4px;
      font-size:0.75rem;
      font-weight:600;
      text-transform:uppercase;
    }
    
    .severity-high .severity-badge {
      background:rgba(248,81,73,0.2);
      color:#fca5a5;
      border:1px solid var(--high);
    }
    
    .severity-medium .severity-badge {
      background:rgba(245,158,11,0.2);
      color:#fcd34d;
      border:1px solid var(--medium);
    }
    
    .severity-low .severity-badge {
      background:rgba(16,185,129,0.2);
      color:#6ee7b7;
      border:1px solid var(--low);
    }
    
    .quantum-badge {
      display:inline-block;
      padding:3px 8px;
      border-radius:4px;
      font-size:0.75rem;
      font-weight:500;
    }
    
    .quantum-true {
      background:rgba(16,185,129,0.2);
      color:#6ee7b7;
    }
    
    .quantum-false {
      background:rgba(248,81,73,0.2);
      color:#fca5a5;
    }
    
    .quantum-partial {
      background:rgba(245,158,11,0.2);
      color:#fcd34d;
    }
    
    @media (max-width:900px) { 
      .stats {
        grid-template-columns:1fr; 
      } 
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Crypto Analysis Dashboard</h1>
    <p class="subtitle">Cryptographic Bill of Materials (CBOM) — Grouped by File</p>

    <div class="stats">
      <div class="stat"><div class="num">${total}</div><div class="label">Detection Sites</div></div>
      <div class="stat high"><div class="num">${high}</div><div class="label">High Risk</div></div>
      <div class="stat medium"><div class="num">${medium}</div><div class="label">Medium Risk</div></div>
      <div class="stat low"><div class="num">${low}</div><div class="label">Low Risk</div></div>
      <div class="stat"><div class="num">${qSafe}</div><div class="label">Post-Quantum Algorithms</div></div>
      <div class="stat high"><div class="num">${qVuln}</div><div class="label">Quantum-Vulnerable</div></div>
      <div class="stat medium"><div class="num">${qReduced}</div><div class="label">Reduced Strength Under Quantum Search</div></div>
    </div>

    <h2 style="margin-top:32px;margin-bottom:16px;color:var(--accent);">Detections by File</h2>
    ${fileSectionsHtml}
  </div>

  <script>
    // File collapse/expand
    function toggleFile(header) {
      header.classList.toggle('collapsed');
      const content = header.nextElementSibling;
      content.classList.toggle('collapsed');
    }

  </script>
</body>
</html>`;

  try {
    fsSync.writeFileSync(outputPath, html, 'utf8');
    console.log(`[generateDashboardHtml] ✅ Dashboard written: ${outputPath}`);
  } catch (err) {
    console.error('[generateDashboardHtml] Failed to write dashboard:', err);
    const fallback = path.join(os.tmpdir(), `crypto-detector-dashboard-${Date.now()}.html`);
    try { 
      fsSync.writeFileSync(fallback, html, 'utf8'); 
      console.log(`[generateDashboardHtml] Wrote to fallback location: ${fallback}`);
    } catch {}
  }
}
