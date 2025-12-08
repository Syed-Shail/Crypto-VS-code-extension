// src/core/scan-engine.ts
// PART 1 of 5 — Imports, Types, Helpers
// Paste PART 1 first, then PART 2..PART 5 in sequence.

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import simpleGit from 'simple-git';

/* ----------------------- Types ----------------------- */
export interface CryptoAsset {
  name: string;
  type?: string;
  primitive?: string;
  assetType?: string;
  description?: string;
  quantumSafe?: boolean | 'partial' | 'unknown';
  severity?: 'low' | 'medium' | 'high' | 'none' | string;
  score?: number;
  riskScore?: number;
  reason?: string;
  source?: string;
  line?: number;
  occurrences?: number;
  id?: string;
  detectionContexts?: Array<{
    filePath?: string;
    lineNumbers?: number[];
    snippet?: string;
  }>;
}

/* ----------------------- Helpers ----------------------- */

/**
 * Cross-platform opener for HTML / file paths.
 * Attempts to spawn the native opener and quietly fails if not available.
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
      // use cmd.exe start "" "<path>"
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
    // silent - caller should print fallback guidance if desired
  }
}

/* ----------------------- Rules loader & fallback ----------------------- */
interface DetectionRule {
  name: string;
  primitive?: string;
  type?: string;
  quantumSafe?: boolean | 'partial' | 'unknown';
  patterns: string[];
  description?: string;
  severity?: string;
}

/**
 * Load rules from parser/rules/crypto-rules.json relative to compiled JS.
 * If not present, return a conservative fallback set.
 */
export function loadCryptoRules(): Record<string, DetectionRule[]> {
  const rulesPath = path.join(__dirname, '..', 'parser', 'rules', 'crypto-rules.json');
  try {
    const rulesData = fsSync.readFileSync(rulesPath, 'utf8');
    return JSON.parse(rulesData);
  } catch (err) {
    return getFallbackRules();
  }
}

function getFallbackRules(): Record<string, DetectionRule[]> {
  return {
    common: [
      { name: 'MD5', type: 'hash', quantumSafe: false, patterns: ['md5', 'MD5'], severity: 'high', description: 'MD5 is cryptographically broken' },
      { name: 'SHA1', type: 'hash', quantumSafe: false, patterns: ['sha1', 'SHA-1'], severity: 'high', description: 'SHA-1 is deprecated' },
      { name: 'SHA256', type: 'hash', quantumSafe: 'partial', patterns: ['sha256', 'SHA-256'], severity: 'low', description: 'SHA-256 is secure' },
      { name: 'AES', type: 'symmetric', quantumSafe: 'partial', patterns: ['AES', 'aes'], severity: 'low', description: 'AES encryption' },
      { name: 'RSA', type: 'asymmetric', quantumSafe: false, patterns: ['RSA', 'rsa'], severity: 'high', description: 'RSA is not quantum-safe' },
      { name: 'ECDSA', type: 'asymmetric', quantumSafe: false, patterns: ['ECDSA', 'ecdsa'], severity: 'high', description: 'ECDSA is vulnerable to quantum' }
    ]
  };
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

/* ----------------------- Small utilities ----------------------- */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeHtml(s: any): string {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[m]);
}
// PART 2 of 5 — scanFile and scanFolder

/* ----------------------- scanFile (line-by-line regex search) ----------------------- */
export async function scanFile(filePath: string): Promise<CryptoAsset[]> {
  const content = await fs.readFile(filePath, 'utf8').catch(() => '');
  if (!content) return [];

  const rules = loadCryptoRules();
  const allRules: DetectionRule[] = [];
  for (const k in rules) {
    if (Array.isArray(rules[k])) allRules.push(...rules[k]);
  }

  const results: CryptoAsset[] = [];
  const lines = content.split(/\r?\n/);
  const seen = new Set<string>();

  for (const rule of allRules) {
    const patterns = rule.patterns && rule.patterns.length ? rule.patterns : [rule.name];
    for (const pattern of patterns) {
      const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'gi');

      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          const lineNumber = idx + 1;
          const key = `${rule.name}::${filePath}::${lineNumber}`;
          if (seen.has(key)) return;
          seen.add(key);

          const risk = assignRisk(rule.quantumSafe, rule.type || rule.primitive, rule.name);

          results.push({
            name: rule.name,
            type: rule.type || rule.primitive || 'unknown',
            primitive: rule.primitive || rule.type || 'unknown',
            assetType: 'algorithm',
            description: rule.description || '',
            quantumSafe: rule.quantumSafe ?? 'unknown',
            severity: (risk.severity as any) || 'unknown',
            score: risk.score,
            riskScore: risk.score,
            reason: risk.explanation,
            source: filePath,
            line: lineNumber,
            occurrences: 1,
            id: `scan:${rule.name.toLowerCase()}-${path.basename(filePath)}-${lineNumber}`,
            detectionContexts: [{
              filePath,
              lineNumbers: [lineNumber],
              snippet: line.trim().substring(0, 300)
            }]
          });
        }
      });
    }
  }

  return results;
}

/* ----------------------- scanFolder (recursive) ----------------------- */
export async function scanFolder(root: string): Promise<CryptoAsset[]> {
  const allAssets: CryptoAsset[] = [];

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

      // skip common heavy folders
      if (full.includes('node_modules') || full.includes('.git') || full.includes('dist') || full.includes('build')) continue;

      if (entry.isDirectory()) {
        files.push(...getAllFiles(full));
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
    return files;
  }

  const allFiles = getAllFiles(root);
  const codeFiles = allFiles.filter(f => /\.(js|ts|py|java|cpp|c|h|go|rs)$/i.test(f));

  for (const f of codeFiles) {
    try {
      const assets = await scanFile(f);
      if (assets.length) allAssets.push(...assets);
    } catch {
      // ignore single-file errors
    }
  }

  return allAssets;
}
// PART 3 of 5 — scanGithubRepo (long-path safe GitHub scanner)

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
  console.log(`📥 Cloning repository: ${repoUrl}`);

  // Pick short Windows directory to avoid MAX_PATH issues.
  const repoName = repoUrl.split('/').pop()?.replace('.git', '') ?? 'repo';
  let targetDir: string;

  if (process.platform === 'win32' && fsSync.existsSync('C:\\r')) {
    targetDir = path.join('C:\\r', `cd-${Date.now()}`);
  } else if (process.platform === 'win32') {
    // fallback if C:\r doesn't exist
    targetDir = path.join('C:\\', `cd-${Date.now()}`);
  } else {
    // Linux/macOS
    targetDir = path.join(os.tmpdir(), `crypto-detector-${repoName}-${Date.now()}`);
  }

  fsSync.mkdirSync(targetDir, { recursive: true });

  const git = simpleGit();

  /* ----------------------- Attempt shallow clone with long-path support ----------------------- */
  try {
    await git.clone(repoUrl, targetDir, [
      '--config', 'core.longpaths=true',
      '--depth', '1'
    ]);

    console.log(`✅ Shallow clone succeeded.`);
  } catch (err) {
    console.warn('⚠️ Shallow clone failed — retrying full clone with long-path support...');

    try {
      await git.clone(repoUrl, targetDir, [
        '--config', 'core.longpaths=true'
      ]);
      console.log('✅ Full clone succeeded.');
    } catch (err2) {
      console.error('❌ Failed to clone repository even with long-path support.');
      throw err2;
    }
  }

  console.log(`📁 Repository cloned into: ${targetDir}`);

  /* ----------------------- Walk directory for files ----------------------- */
  const allFiles: string[] = [];

  function walk(dir: string): void {
    let entries: fsSync.Dirent[];
    try {
      entries = fsSync.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (full.includes('node_modules') || full.includes('.git') || full.includes('dist') || full.includes('build')) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        allFiles.push(full);
      }
    }
  }

  walk(targetDir);

  const codeFiles = allFiles.filter(f =>
    /\.(js|ts|py|java|cpp|c|h|go|rs)$/i.test(f)
  );

  console.log(`🔍 Found ${codeFiles.length} code files.`);

  /* ----------------------- Scan all supported files ----------------------- */
  const allAssets: CryptoAsset[] = [];

  for (const f of codeFiles) {
    try {
      const assets = await scanFile(f);
      if (assets.length > 0) {
        console.log(`📌 ${path.relative(targetDir, f)} → ${assets.length} detections`);
      }
      allAssets.push(...assets);
    } catch (err) {
      console.error(`❌ Error scanning ${f}`);
    }
  }

  /* ----------------------- Generate output files ----------------------- */
  fsSync.mkdirSync(outputDir, { recursive: true });

  const cbomPath = path.join(outputDir, `${repoName}-cbom.json`);
  await generateCBOM(allAssets, cbomPath);

  const dashboardPath = path.join(outputDir, `${repoName}-dashboard.html`);
  await generateDashboardHtml(allAssets, dashboardPath);

  console.log(`📦 CBOM saved: ${cbomPath}`);
  console.log(`📊 Dashboard saved: ${dashboardPath}`);

  return {
    repoDir: targetDir,
    codeFiles: codeFiles.length,
    detections: allAssets.length,
    cbomPath,
    dashboardPath
  };
}
// PART 4 of 5 — generateCBOM (CycloneDX JSON output)

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
      riskScore: asset.riskScore ?? asset.score ?? 0
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
          version: "2.0.0"
        }
      ]
    },
    components,
    statistics: {
      totalDetected: assets.length,
      highRisk: assets.filter(a => a.severity === "high").length,
      mediumRisk: assets.filter(a => a.severity === "medium").length,
      lowRisk: assets.filter(a => a.severity === "low").length
    }
  };

  await fs.writeFile(outputPath, JSON.stringify(cbom, null, 2), "utf8");
}
// PART 5 of 5 — generateDashboardHtml (Full Beautiful Dashboard using Chart.js)

export function generateDashboardHtml(assets: CryptoAsset[], outputPath: string): void {
  const total = assets.length;
  const high = assets.filter(a => String(a.severity).toLowerCase() === 'high').length;
  const medium = assets.filter(a => String(a.severity).toLowerCase() === 'medium').length;
  const low = assets.filter(a => String(a.severity).toLowerCase() === 'low').length;
  const qSafe = assets.filter(a => a.quantumSafe === true).length;
  const qVuln = assets.filter(a => a.quantumSafe === false).length;

  const rowsHtml = assets.map(a => `
    <tr>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td>${escapeHtml(a.primitive || a.type || 'unknown')}</td>
      <td>${escapeHtml(String(a.quantumSafe))}</td>
      <td class="severity-${escapeHtml(String(a.severity))}">${escapeHtml(String(a.severity || 'unknown')).toUpperCase()}</td>
      <td>${escapeHtml(String(a.riskScore ?? a.score ?? 0))}</td>
      <td>${escapeHtml(String(a.occurrences ?? 1))}</td>
    </tr>`).join('\n');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Crypto Analysis Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root { --bg:#f4f6fb; --card:#ffffff; --muted:#6b7280; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; background:var(--bg); padding:24px; }
    .container { max-width:1200px; margin:0 auto; background:var(--card); border-radius:12px; padding:20px; box-shadow:0 10px 30px rgba(2,6,23,0.08); }
    h1 { margin:0 0 12px 0; font-size:22px; }
    .stats { display:flex; gap:12px; margin:16px 0 24px 0; }
    .stat { flex:1; padding:14px; border-radius:10px; color:white; background:linear-gradient(90deg,#667eea,#764ba2); text-align:center; }
    .stat .num { font-size:24px; font-weight:700; }
    .charts { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom:20px; }
    .card { background:#fff; padding:14px; border-radius:10px; box-shadow: 0 6px 18px rgba(2,6,23,0.04); }
    table { width:100%; border-collapse:collapse; margin-top:12px; }
    th, td { padding:10px 8px; text-align:left; border-bottom:1px solid #eef2f7; font-size:13px; }
    th { background:#fbfdff; font-weight:600; color:#111827; }
    .severity-high { color:#d32f2f; font-weight:700; }
    .severity-medium { color:#f57c00; font-weight:700; }
    .severity-low { color:#388e3c; font-weight:700; }
    @media (max-width:900px) { .charts { grid-template-columns: 1fr; } .stats { flex-direction:column; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Crypto Analysis Dashboard</h1>

    <div class="stats" role="region" aria-label="summary stats">
      <div class="stat"><div class="num">${total}</div><div class="label">Total Assets</div></div>
      <div class="stat"><div class="num">${high}</div><div class="label">High Risk</div></div>
      <div class="stat"><div class="num">${medium}</div><div class="label">Medium Risk</div></div>
      <div class="stat"><div class="num">${low}</div><div class="label">Low Risk</div></div>
    </div>

    <div class="charts" role="region" aria-label="charts">
      <div class="card">
        <h3 style="margin:0 0 10px 0;">Risk Distribution</h3>
        <canvas id="riskChart" width="400" height="260" aria-label="Risk distribution chart"></canvas>
      </div>
      <div class="card">
        <h3 style="margin:0 0 10px 0;">Quantum Readiness</h3>
        <canvas id="quantumChart" width="400" height="260" aria-label="Quantum readiness chart"></canvas>
      </div>
    </div>

    <div class="card" role="region" aria-label="detected algorithms">
      <h3 style="margin:0 0 10px 0;">Detected Algorithms</h3>
      <div style="overflow:auto; max-height:480px;">
        <table>
          <thead>
            <tr><th>Algorithm</th><th>Type</th><th>Quantum-Safe</th><th>Severity</th><th>Risk Score</th><th>Occurrences</th></tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>

  </div>

  <script>
    (function(){
      const riskCtx = document.getElementById('riskChart').getContext('2d');
      new Chart(riskCtx, {
        type: 'doughnut',
        data: {
          labels: ['High','Medium','Low'],
          datasets: [{
            data: [${high}, ${medium}, ${low}],
            backgroundColor: ['#d32f2f','#f57c00','#388e3c'],
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' }
          }
        }
      });

      const qCtx = document.getElementById('quantumChart').getContext('2d');
      new Chart(qCtx, {
        type: 'bar',
        data: {
          labels: ['Quantum-Safe','Quantum-Vulnerable'],
          datasets: [{
            label: 'Count',
            data: [${qSafe}, ${qVuln}],
            backgroundColor: ['#388e3c','#d32f2f']
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: { beginAtZero: true, ticks: { precision: 0 } }
          },
          plugins: { legend: { display: false } }
        }
      });
    })();
  </script>
</body>
</html>`;

  try {
    fsSync.writeFileSync(outputPath, html, 'utf8');
  } catch (err) {
    // If write fails, try writing to tmp and return that path
    const fallback = path.join(os.tmpdir(), `crypto-detector-dashboard-${Date.now()}.html`);
    try { fsSync.writeFileSync(fallback, html, 'utf8'); } catch { /* swallow */ }
    // Not throwing — caller can log fallback location if needed
  }
}
