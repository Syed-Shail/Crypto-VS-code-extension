// src/cli.ts - Complete CLI with working browser open functionality
import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import * as os from 'os';

// Types
interface CryptoAsset {
  name: string;
  type?: string;
  primitive?: string;
  assetType?: string;
  description?: string;
  quantumSafe?: boolean | 'partial' | 'unknown';
  severity?: 'low' | 'medium' | 'high' | 'none';
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

// ==================== BROWSER OPENING ====================

/**
 * Open a file or URL in the default browser/application
 * Cross-platform implementation using native Node.js
 */
function openInBrowser(target: string): void {
  const platform = os.platform();
  let command: string;
  let args: string[];

  switch (platform) {
    case 'darwin': // macOS
      command = 'open';
      args = [target];
      break;
    case 'win32': // Windows
      command = 'cmd.exe';
      args = ['/c', 'start', '', target];
      break;
    default: // Linux
      command = 'xdg-open';
      args = [target];
      break;
  }

  // Spawn the process
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore'
  });

  // Unref so the parent process can exit
  child.unref();

  // Handle errors
  child.on('error', (error) => {
    console.error(`❌ Failed to open browser: ${error.message}`);
    console.log(`💡 You can manually open: ${target}`);
  });

  console.log(`🌐 Opening in browser...`);
}

// ==================== DETECTION LOGIC ====================

interface DetectionRule {
  name: string;
  primitive?: string;
  type?: string;
  quantumSafe?: boolean | 'partial' | 'unknown';
  patterns: string[];
  description?: string;
  severity?: string;
}

// Load crypto rules
function loadCryptoRules(): Record<string, DetectionRule[]> {
  const rulesPath = path.join(__dirname, 'parser', 'rules', 'crypto-rules.json');
  try {
    const rulesData = fsSync.readFileSync(rulesPath, 'utf8');
    return JSON.parse(rulesData);
  } catch (err) {
    console.warn('⚠️  Could not load crypto-rules.json, using fallback rules');
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
      { name: 'ECDSA', type: 'asymmetric', quantumSafe: false, patterns: ['ECDSA', 'ecdsa'], severity: 'high', description: 'ECDSA is vulnerable to quantum' },
    ]
  };
}

// Risk assessment
function assignRisk(
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

// Scan a single file
async function scanFile(filePath: string): Promise<CryptoAsset[]> {
  const content = await fs.readFile(filePath, 'utf8');
  const rules = loadCryptoRules();
  const allRules: DetectionRule[] = [];

  // Flatten all language rules
  for (const langKey in rules) {
    allRules.push(...rules[langKey]);
  }

  const results: CryptoAsset[] = [];
  const lines = content.split('\n');
  const seenDetections = new Set<string>();

  for (const rule of allRules) {
    const patterns = rule.patterns || [rule.name];

    for (const pattern of patterns) {
      const regex = new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'gi');

      lines.forEach((line, index) => {
        const matches = line.match(regex);
        if (matches) {
          const lineNumber = index + 1;
          const detectionKey = `${rule.name}-${filePath}-${lineNumber}`;
          
          if (seenDetections.has(detectionKey)) {
            return;
          }
          seenDetections.add(detectionKey);

          const risk = assignRisk(rule.quantumSafe, rule.type || rule.primitive, rule.name);

          results.push({
            name: rule.name,
            type: rule.type || rule.primitive || 'unknown',
            primitive: rule.primitive || rule.type || 'unknown',
            assetType: 'algorithm',
            description: rule.description || '',
            quantumSafe: rule.quantumSafe || 'unknown',
            severity: risk.severity as any,
            score: risk.score,
            riskScore: risk.score,
            reason: risk.explanation,
            source: filePath,
            line: lineNumber,
            occurrences: 1,
            id: `cli:${rule.name.toLowerCase()}-${lineNumber}`,
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================== CBOM GENERATION ====================

async function generateCBOM(assets: CryptoAsset[], outputPath: string): Promise<void> {
  const components = assets.map((a, i) => ({
    type: 'cryptographic-asset',
    'bom-ref': a.id || `asset-${i}`,
    name: a.name || 'Unknown',
    evidence: {
      occurrences: (a.detectionContexts || []).map(ctx => ({
        location: ctx.filePath || 'unknown',
        lineNumbers: ctx.lineNumbers || [],
        snippet: (ctx.snippet || '').substring(0, 300)
      }))
    },
    cryptoProperties: {
      assetType: a.assetType || 'algorithm',
      algorithmProperties: {
        primitive: a.primitive || a.type || 'unknown',
        cryptoFunctions: [a.description || 'unknown']
      },
      quantumSafe: String(a.quantumSafe || 'unknown'),
      severity: a.severity || 'unknown',
      riskScore: a.riskScore || a.score || 0
    }
  }));

  const cbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{
        vendor: 'Syed Shail',
        name: 'Crypto Detector CLI',
        version: '1.0.0'
      }]
    },
    components,
    statistics: {
      totalDetected: assets.length,
      highRisk: assets.filter(a => a.severity === 'high').length,
      mediumRisk: assets.filter(a => a.severity === 'medium').length,
      lowRisk: assets.filter(a => a.severity === 'low').length
    }
  };

  await fs.writeFile(outputPath, JSON.stringify(cbom, null, 2), 'utf8');
}

// ==================== DASHBOARD HTML ====================

function generateDashboardHtml(assets: CryptoAsset[], outputPath: string): void {
  const total = assets.length;
  const high = assets.filter(a => a.severity === 'high').length;
  const medium = assets.filter(a => a.severity === 'medium').length;
  const low = assets.filter(a => a.severity === 'low').length;
  const qSafe = assets.filter(a => a.quantumSafe === true).length;
  const qVuln = assets.filter(a => a.quantumSafe === false).length;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Crypto Analysis Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      min-height: 100vh;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    h1 {
      color: #333;
      margin-bottom: 30px;
      font-size: 32px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .stat-card {
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      padding: 24px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value {
      font-size: 48px;
      font-weight: bold;
      margin-bottom: 8px;
    }
    .stat-label {
      font-size: 14px;
      opacity: 0.9;
    }
    .charts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 30px;
      margin-bottom: 40px;
    }
    .chart-container {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e0e0e0;
    }
    th {
      background: #f5f5f5;
      font-weight: 600;
      color: #333;
    }
    tr:hover {
      background: #f9f9f9;
    }
    .severity-high { color: #d32f2f; font-weight: bold; }
    .severity-medium { color: #f57c00; font-weight: bold; }
    .severity-low { color: #388e3c; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Cryptographic Analysis Dashboard</h1>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${total}</div>
        <div class="stat-label">Total Assets</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${high}</div>
        <div class="stat-label">High Risk</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${medium}</div>
        <div class="stat-label">Medium Risk</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${low}</div>
        <div class="stat-label">Low Risk</div>
      </div>
    </div>

    <div class="charts">
      <div class="chart-container">
        <h3>Risk Distribution</h3>
        <canvas id="riskChart"></canvas>
      </div>
      <div class="chart-container">
        <h3>Quantum Readiness</h3>
        <canvas id="quantumChart"></canvas>
      </div>
    </div>

    <h2>Detected Algorithms</h2>
    <table>
      <thead>
        <tr>
          <th>Algorithm</th>
          <th>Type</th>
          <th>Quantum-Safe</th>
          <th>Severity</th>
          <th>Risk Score</th>
          <th>Occurrences</th>
        </tr>
      </thead>
      <tbody>
        ${assets.map(a => `
          <tr>
            <td><strong>${a.name}</strong></td>
            <td>${a.primitive || a.type}</td>
            <td>${a.quantumSafe}</td>
            <td class="severity-${a.severity}">${(a.severity || 'unknown').toUpperCase()}</td>
            <td>${a.riskScore || 0}</td>
            <td>${a.occurrences || 1}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <script>
    new Chart(document.getElementById('riskChart'), {
      type: 'doughnut',
      data: {
        labels: ['High', 'Medium', 'Low'],
        datasets: [{
          data: [${high}, ${medium}, ${low}],
          backgroundColor: ['#d32f2f', '#f57c00', '#388e3c']
        }]
      }
    });

    new Chart(document.getElementById('quantumChart'), {
      type: 'bar',
      data: {
        labels: ['Quantum-Safe', 'Quantum-Vulnerable'],
        datasets: [{
          data: [${qSafe}, ${qVuln}],
          backgroundColor: ['#388e3c', '#d32f2f']
        }]
      },
      options: {
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  </script>
</body>
</html>`;

  fsSync.writeFileSync(outputPath, html, 'utf8');
  
  // Open the dashboard in browser
  openInBrowser(outputPath);
}

// ==================== CLI COMMANDS ====================

const program = new Command();

program
  .name('crypto-detector')
  .description('CLI tool for detecting cryptographic algorithms in code')
  .version('1.0.0');

program
  .command('scan <files...>')
  .description('Scan files for cryptographic algorithms')
  .option('-o, --output <dir>', 'Output directory for reports', './crypto-analysis')
  .option('--no-browser', 'Do not open dashboard in browser')
  .action(async (files: string[], options) => {
    console.log('🔐 Crypto Detector CLI - File Scan\n');
    
    const outputDir = path.resolve(options.output);
    await fs.mkdir(outputDir, { recursive: true });

    const allAssets: CryptoAsset[] = [];

    console.log(`📄 File: ${files.join(', ')}`);
    console.log(`🔍 Scanning ${files.length} files...`);

    for (const file of files) {
      const filePath = path.resolve(file);
      
      if (!fsSync.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        continue;
      }

      try {
        const assets = await scanFile(filePath);
        console.log(`✅ ${path.basename(filePath)}: Found ${assets.length} algorithm(s)`);
        allAssets.push(...assets);
      } catch (err: any) {
        console.error(`❌ Error scanning ${filePath}: ${err.message}`);
      }
    }

    // Print summary
    const high = allAssets.filter(a => a.severity === 'high').length;
    const medium = allAssets.filter(a => a.severity === 'medium').length;
    const low = allAssets.filter(a => a.severity === 'low').length;
    const qSafe = allAssets.filter(a => a.quantumSafe === true).length;
    const qVuln = allAssets.filter(a => a.quantumSafe === false).length;

    console.log('\n' + '='.repeat(60));
    console.log('📊 SCAN SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Assets Detected: ${allAssets.length}`);
    console.log('Risk Levels:');
    console.log(`  🔴 High Risk:    ${high}`);
    console.log(`  🟡 Medium Risk:  ${medium}`);
    console.log(`  🟢 Low Risk:     ${low}`);
    console.log('Quantum Readiness:');
    console.log(`  ✅ Quantum-Safe:      ${qSafe}`);
    console.log(`  ❌ Quantum-Vulnerable: ${qVuln}`);
    console.log('='.repeat(60) + '\n');

    // Generate CBOM
    const cbomPath = path.join(outputDir, 'cbom-report.json');
    await generateCBOM(allAssets, cbomPath);
    console.log(`📦 CBOM saved to: ${cbomPath}`);

    // Generate Dashboard
    const dashboardPath = path.join(outputDir, 'dashboard.html');
    generateDashboardHtml(allAssets, dashboardPath);
    console.log(`📊 Dashboard saved to: ${dashboardPath}`);

    if (options.browser !== false) {
      console.log('🌐 Opening dashboard in browser...');
    }
  });

program.parse();