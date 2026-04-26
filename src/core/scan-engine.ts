// src/core/scan-engine.ts - FIXED to use improved parser module
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import simpleGit from 'simple-git';
import * as vscode from 'vscode';

// Import the improved parser module
import { regexDetector } from '../parser/regex-detector';
import { CryptoAsset } from '../parser/types';
import { getQuantumAlternativeSuggestion } from '../parser/quantum-alternatives';

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
): { severity: string; score: number; explanation: string } {
  let severity = 'low';
  let score = 10;
  let explanation = 'Low risk detection.';

  if (quantumSafe === false) {
    severity = 'high';
    score = 90;
    explanation = `${name} is not quantum-safe or is insecure.`;
  } else if (quantumSafe === 'partial') {
    severity = 'medium';
    score = 55;
    explanation = `${name} has partial quantum resistance.`;
  } else if (quantumSafe === true) {
    severity = 'low';
    score = 10;
    explanation = `${name} is quantum-safe.`;
  }

  return { severity, score, explanation };
}

/* ----------------------- Utilities ----------------------- */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeHtml(s: any): string {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[m]);
}

/* ----------------------- scanFile using improved detector ----------------------- */
export async function scanFile(filePath: string): Promise<CryptoAsset[]> {
  try {
    console.log(`[scanFile] Scanning: ${path.basename(filePath)}`);
    
    // Check if file should be skipped
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath).toLowerCase();
    
    const excludedExts = ['.json', '.xml', '.md', '.txt', '.pdf', '.png', '.jpg', '.gif', '.svg', '.zip', '.tar', '.gz', '.lock', '.log', '.min.js', '.map'];
    const excludedPatterns = ['cbom', 'package-lock', 'yarn.lock', '.min.', 'bundle', 'vendor'];
    
    if (excludedExts.includes(ext)) {
      console.log(`[scanFile] Skipping (excluded extension): ${filename}`);
      return [];
    }
    
    if (excludedPatterns.some(p => filename.includes(p))) {
      console.log(`[scanFile] Skipping (excluded pattern): ${filename}`);
      return [];
    }
    
    const content = await fs.readFile(filePath, 'utf8');
    
    if (!content || content.trim().length === 0) {
      console.log(`[scanFile] Skipping (empty file): ${filename}`);
      return [];
    }
    
    // Use improved regex detector
    const results = regexDetector.scan(content, filePath);
    
    if (results.length > 0) {
      console.log(`[scanFile] ✓ Found ${results.length} detection(s) in ${filename}`);
    }
    
    return results;
  } catch (err) {
    console.error(`[scanFile] Error scanning ${filePath}:`, err);
    return [];
  }
}

/* ----------------------- scanFolder (recursive) ----------------------- */
export async function scanFolder(root: string): Promise<CryptoAsset[]> {
  console.log(`[scanFolder] Starting scan of: ${root}`);
  
  const allAssets: CryptoAsset[] = [];
  const assetMap = new Map<string, CryptoAsset>();

  function getAllFiles(dir: string): string[] {
    let entries: fsSync.Dirent[];
    try {
      entries = fsSync.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      // Skip common heavy folders
      const skipDirs = ['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '__pycache__', 'venv', '.venv'];
      if (skipDirs.some(d => full.includes(path.sep + d + path.sep) || full.endsWith(path.sep + d))) {
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...getAllFiles(full));
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
    return files;
  }

  const allFiles = getAllFiles(root);
  
  // Filter to source code files
  const codeExts = ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.cs', '.php', '.rb', '.swift'];
  const codeFiles = allFiles.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return codeExts.includes(ext);
  });

  console.log(`[scanFolder] Found ${codeFiles.length} source files to scan`);

  for (const f of codeFiles) {
    try {
      const assets = await scanFile(f);
      
      // Deduplicate by creating unique keys
      for (const asset of assets) {
        const key = `${asset.name}:${asset.source}:${asset.line || 0}`;
        
        if (assetMap.has(key)) {
          // Merge occurrences
          const existing = assetMap.get(key)!;
          existing.occurrences = (existing.occurrences || 1) + 1;
          if (asset.detectionContexts) {
            existing.detectionContexts = existing.detectionContexts || [];
            existing.detectionContexts.push(...asset.detectionContexts);
          }
        } else {
          assetMap.set(key, asset);
        }
      }
    } catch (err) {
      console.warn(`[scanFolder] Error scanning ${f}:`, err);
    }
  }

  const deduplicated = Array.from(assetMap.values());
  
  console.log(`[scanFolder] ✅ Scan complete`);
  console.log(`[scanFolder] 📊 Files scanned: ${codeFiles.length}`);
  console.log(`[scanFolder] 🔍 Unique detections: ${deduplicated.length}`);
  console.log(`[scanFolder] 📈 Total occurrences: ${deduplicated.reduce((sum, a) => sum + (a.occurrences || 1), 0)}`);
  
  return deduplicated;
}

/* ----------------------- scanGithubRepo (long-path safe) ----------------------- */
export async function scanGithubRepo(
  repoUrl: string,
  outputDir: string
): Promise<{
  repoDir: string;
  codeFiles: number;
  detections: number;
  cbomPath: string;
  dashboardPath: string;
}> {
  console.log(`\n📥 [GitHub] Cloning repository: ${repoUrl}`);

  // Normalize URL
  let normalizedUrl = repoUrl.trim()
    .replace(/\/blob\/.*/, '')
    .replace(/\.git.*/, '')
    .replace(/\/$/, '');
  
  if (!normalizedUrl.startsWith('https://')) {
    normalizedUrl = 'https://' + normalizedUrl;
  }
  if (!normalizedUrl.endsWith('.git')) {
    normalizedUrl += '.git';
  }

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
      throw new Error(`Failed to clone repository: ${err2}`);
    }
  }

  // Scan the cloned repository
  console.log(`\n🔍 [GitHub] Scanning cloned repository...`);
  const allAssets = await scanFolder(targetDir);

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
          if (['.js', '.ts', '.py', '.java', '.cpp', '.c', '.go', '.rs'].includes(ext)) {
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
  await generateCBOM(allAssets, cbomPath);
  console.log(`📦 [GitHub] CBOM saved: ${cbomPath}`);

  const dashboardPath = path.join(outputDir, `${repoName}-dashboard.html`);
  generateDashboardHtml(allAssets, dashboardPath);
  console.log(`📊 [GitHub] Dashboard saved: ${dashboardPath}`);

  // Cleanup temp directory (optional - comment out for debugging)
  try {
    setTimeout(() => {
      fsSync.rmSync(targetDir, { recursive: true, force: true });
      console.log(`🧹 [GitHub] Cleaned up temp directory`);
    }, 5000);
  } catch {}

  return {
    repoDir: targetDir,
    codeFiles: codeFileCount,
    detections: allAssets.length,
    cbomPath,
    dashboardPath
  };
}

/* ----------------------- generateCBOM ----------------------- */
export async function generateCBOM(assets: CryptoAsset[], outputPath: string): Promise<void> {
  const components = assets.map((asset, index) => ({
    type: "cryptographic-asset",
    "bom-ref": asset.id ?? `asset-${index}`,
    name: asset.name || "Unknown",
    evidence: {
      occurrences: (asset.detectionContexts || []).map(ctx => ({
        location: ctx.filePath || "",
        lineNumbers: ctx.lineNumbers || [],
        snippet: ctx.snippet || ""
      }))
    },
    cryptoProperties: {
      assetType: asset.assetType || "algorithm",
      algorithmProperties: {
        primitive: asset.primitive || asset.type || "unknown",
        cryptoFunctions: [asset.description || "unknown"]
      },
      quantumSafe: `${asset.quantumSafe ?? "unknown"}`,
      severity: asset.severity ?? "unknown",
      riskScore: asset.riskScore ?? asset.score ?? 0,
      migrationRecommendation: getQuantumAlternativeSuggestion(asset).alternative
      migrationRecommendation: getQuantumAlternativeSuggestion(asset)
    }
  }));

  const cbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: "Syed Shail",
          name: "Crypto Detector Engine",
          version: "2.1.1"
        }
      ]
    },
    components,
    statistics: {
      totalDetected: assets.length,
      highRisk: assets.filter(a => a.severity === "high").length,
      mediumRisk: assets.filter(a => a.severity === "medium").length,
      lowRisk: assets.filter(a => a.severity === "low").length,
      quantumSafe: assets.filter(a => a.quantumSafe === true).length,
      quantumVulnerable: assets.filter(a => a.quantumSafe === false).length
    }
  };

  await fs.writeFile(outputPath, JSON.stringify(cbom, null, 2), "utf8");
}

/* ----------------------- generateDashboardHtml ----------------------- */
// src/core/scan-engine.ts - Enhanced generateDashboardHtml with file grouping

export function generateDashboardHtml(assets: CryptoAsset[], outputPath: string): void {
  // Group assets by file
  const byFile: Record<string, CryptoAsset[]> = {};
  
  for (const asset of assets) {
    const contexts = asset.detectionContexts || [];
    for (const ctx of contexts) {
      const file = ctx.filePath || asset.source || 'Unknown';
      if (!byFile[file]) {
        byFile[file] = [];
      }
      byFile[file].push(asset);
    }
  }

  const files = Object.keys(byFile).sort();
  const total = assets.length;
  const high = assets.filter(a => String(a.severity).toLowerCase() === 'high').length;
  const medium = assets.filter(a => String(a.severity).toLowerCase() === 'medium').length;
  const low = assets.filter(a => String(a.severity).toLowerCase() === 'low').length;
  const qSafe = assets.filter(a => a.quantumSafe === true).length;
  const qVuln = assets.filter(a => a.quantumSafe === false).length;

  // Build file sections HTML
  let fileSectionsHtml = '';
  for (const file of files) {
    const filename = path.basename(file);
    const fileAssets = byFile[file];
    
    fileSectionsHtml += `
      <div class="file-section">
        <div class="file-header" onclick="toggleFile(this)">
          <span class="file-icon">📄</span>
          <span class="file-name">${escapeHtml(filename)}</span>
          <span class="file-count">${fileAssets.length} detection(s)</span>
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
                <th>Quantum-Safe</th>
                <th>Severity</th>
                <th>Risk Score</th>
                <th>Suggested Alternative</th>
                <th>Suggestion Basis</th>
              </tr>
            </thead>
            <tbody>
    `;

    // Sort by line number
    const sortedAssets = [...fileAssets].sort((a, b) => {
      const lineA = a.detectionContexts?.[0]?.lineNumbers?.[0] || a.line || 0;
      const lineB = b.detectionContexts?.[0]?.lineNumbers?.[0] || b.line || 0;
      return lineA - lineB;
    });

    for (const asset of sortedAssets) {
      const lineNumbers = asset.detectionContexts?.[0]?.lineNumbers || [asset.line || 0];
      const lineStr = lineNumbers.length > 1 
        ? `${lineNumbers[0]}-${lineNumbers[lineNumbers.length - 1]}`
        : String(lineNumbers[0] || 0);

      const suggestion = getQuantumAlternativeSuggestion(asset);
      fileSectionsHtml += `
        <tr class="severity-${escapeHtml(String(asset.severity || 'unknown'))}">
          <td class="line-number">${lineStr}</td>
          <td><strong>${escapeHtml(asset.name)}</strong></td>
          <td>${escapeHtml(asset.primitive || asset.type || 'unknown')}</td>
          <td><span class="quantum-badge quantum-${escapeHtml(String(asset.quantumSafe))}">${escapeHtml(String(asset.quantumSafe))}</span></td>
          <td><span class="severity-badge">${escapeHtml(String(asset.severity || 'unknown').toUpperCase())}</span></td>
          <td>${escapeHtml(String(asset.riskScore ?? asset.score ?? 0))}</td>
          <td>${escapeHtml(suggestion.alternative)}</td>
          <td>${escapeHtml(suggestion.basis)}</td>
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
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
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
    
    .charts { 
      display:grid; 
      grid-template-columns:repeat(auto-fit, minmax(400px, 1fr)); 
      gap:20px; 
      margin-bottom:24px; 
    }
    
    .card { 
      background:var(--card); 
      border:1px solid var(--border); 
      border-radius:8px; 
      padding:20px; 
    }
    
    .card h3 {
      margin:0 0 16px 0;
      font-size:1.1rem;
    }
    
    canvas { 
      max-height:280px !important; 
    }
    
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
      .charts, .stats { 
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
      <div class="stat"><div class="num">${total}</div><div class="label">Total Assets</div></div>
      <div class="stat high"><div class="num">${high}</div><div class="label">High Risk</div></div>
      <div class="stat medium"><div class="num">${medium}</div><div class="label">Medium Risk</div></div>
      <div class="stat low"><div class="num">${low}</div><div class="label">Low Risk</div></div>
      <div class="stat"><div class="num">${qSafe}</div><div class="label">Quantum-Safe</div></div>
      <div class="stat high"><div class="num">${qVuln}</div><div class="label">Vulnerable</div></div>
    </div>

    <div class="charts">
      <div class="card">
        <h3>Risk Distribution</h3>
        <canvas id="riskChart"></canvas>
      </div>
      <div class="card">
        <h3>Quantum Readiness</h3>
        <canvas id="quantumChart"></canvas>
      </div>
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

    // Charts
    new Chart(document.getElementById('riskChart'), {
      type: 'doughnut',
      data: {
        labels: ['High','Medium','Low'],
        datasets: [{
          data: [${high}, ${medium}, ${low}],
          backgroundColor: ['#f85149','#f0ad4e','#3fb950']
        }]
      },
      options: { 
        plugins: { 
          legend: { labels: { color: '#e6edf3' } } 
        } 
      }
    });

    new Chart(document.getElementById('quantumChart'), {
      type: 'bar',
      data: {
        labels: ['Quantum-Safe','Vulnerable'],
        datasets: [{
          label: 'Count',
          data: [${qSafe}, ${qVuln}],
          backgroundColor: ['#3fb950','#f85149']
        }]
      },
      options: {
        scales: {
          y: { beginAtZero: true, ticks: { color: '#e6edf3' } },
          x: { ticks: { color: '#e6edf3' } }
        },
        plugins: { legend: { display: false } }
      }
    });
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