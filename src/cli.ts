#!/usr/bin/env node
// src/cli.ts - Enhanced CLI with GitHub support and dashboard generation

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { simpleGit } from 'simple-git';
import { regexDetector } from './parser/regex-detector';
import { CryptoAsset } from './parser/types';
import { writeCbomJson } from './parser/report-writer';

const program = new Command();

program
  .name('crypto-detector')
  .description('CLI tool to detect cryptographic algorithms in source code')
  .version('2.0.0');

/**
 * Check if a file is a supported source file
 */
function isSupportedFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.rs', '.go', '.cs', '.php', '.rb', '.swift'].includes(ext);
}

/**
 * Get list of files to scan (handles both files and directories)
 */
function getFilesToScan(target: string): string[] {
  const resolved = path.resolve(target);
  
  if (!fs.existsSync(resolved)) {
    console.error(`❌ Path not found: ${resolved}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolved);
  
  // If it's a file, return it directly (if supported)
  if (stat.isFile()) {
    if (!isSupportedFile(resolved)) {
      console.error(`❌ Unsupported file type: ${path.basename(resolved)}`);
      console.log(`\nSupported extensions: .js, .jsx, .ts, .tsx, .py, .java, .cpp, .c, .h, .rs, .go, .cs, .php, .rb, .swift`);
      process.exit(1);
    }
    return [resolved];
  }
  
  // If it's a directory, walk it recursively
  return walkDir(resolved);
}

/**
 * Recursively scan a directory for source files
 */
function walkDir(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip common directories
      if (['node_modules', '.git', 'dist', 'out', 'build', 'target'].includes(file)) {
        return;
      }
      walkDir(filePath, fileList);
    } else {
      // Check if it's a source file
      if (isSupportedFile(file)) {
        fileList.push(filePath);
      }
    }
  });
  
  return fileList;
}

/**
 * Scan files and return detected assets
 */
function scanFiles(files: string[]): CryptoAsset[] {
  const allAssets: CryptoAsset[] = [];
  
  console.log(`\n🔍 Scanning ${files.length} files...\n`);
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const assets = regexDetector.scan(content, file);
      allAssets.push(...assets);
      
      if (assets.length > 0) {
        console.log(`✅ ${path.basename(file)}: Found ${assets.length} algorithm(s)`);
      }
    } catch (err: any) {
      console.warn(`⚠️  Skipped ${file}: ${err.message}`);
    }
  }
  
  return allAssets;
}

/**
 * Generate HTML dashboard report
 */
function generateDashboardHtml(assets: CryptoAsset[], outputPath: string): void {
  const total = assets.length;
  const high = assets.filter(a => a.severity === 'high').length;
  const medium = assets.filter(a => a.severity === 'medium').length;
  const low = assets.filter(a => a.severity === 'low').length;
  const qSafe = assets.filter(a => a.quantumSafe === true).length;
  const qVuln = assets.filter(a => a.quantumSafe === false).length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Crypto Detector - Dashboard Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      padding: 20px;
      min-height: 100vh;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    h1 {
      text-align: center;
      margin-bottom: 30px;
      font-size: 2.5em;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
    }
    .timestamp {
      text-align: center;
      opacity: 0.8;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .summary-card {
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      transition: transform 0.2s;
    }
    .summary-card:hover {
      transform: translateY(-5px);
    }
    .summary-card h3 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
      opacity: 0.9;
    }
    .summary-card .value {
      font-size: 48px;
      font-weight: bold;
    }
    .charts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 24px;
      margin-bottom: 40px;
    }
    .chart-card {
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    .chart-card h2 {
      margin-bottom: 20px;
      font-size: 18px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: rgba(255,255,255,0.15);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }
    th, td {
      padding: 14px;
      text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    th {
      background: rgba(0,0,0,0.2);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 13px;
      letter-spacing: 0.5px;
    }
    tr:hover {
      background: rgba(255,255,255,0.05);
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-high { background: #ef4444; }
    .badge-medium { background: #f59e0b; }
    .badge-low { background: #10b981; }
    .badge-safe { background: #10b981; }
    .badge-vulnerable { background: #ef4444; }
    .badge-partial { background: #f59e0b; }
    .footer {
      text-align: center;
      margin-top: 40px;
      opacity: 0.7;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔐 Cryptographic Analysis Report</h1>
    <div class="timestamp">Generated on ${new Date().toLocaleString()}</div>
    
    <div class="summary-grid">
      <div class="summary-card">
        <h3>Total Assets</h3>
        <div class="value">${total}</div>
      </div>
      <div class="summary-card">
        <h3>High Risk</h3>
        <div class="value" style="color:#ef4444">${high}</div>
      </div>
      <div class="summary-card">
        <h3>Medium Risk</h3>
        <div class="value" style="color:#f59e0b">${medium}</div>
      </div>
      <div class="summary-card">
        <h3>Low Risk</h3>
        <div class="value" style="color:#10b981">${low}</div>
      </div>
      <div class="summary-card">
        <h3>Quantum-Safe</h3>
        <div class="value" style="color:#10b981">${qSafe}</div>
      </div>
      <div class="summary-card">
        <h3>Vulnerable</h3>
        <div class="value" style="color:#ef4444">${qVuln}</div>
      </div>
    </div>

    <div class="charts">
      <div class="chart-card">
        <h2>Risk Distribution</h2>
        <canvas id="riskChart"></canvas>
      </div>
      <div class="chart-card">
        <h2>Quantum Readiness</h2>
        <canvas id="quantumChart"></canvas>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Algorithm</th>
          <th>Type</th>
          <th>Severity</th>
          <th>Quantum-Safe</th>
          <th>Risk Score</th>
          <th>Occurrences</th>
        </tr>
      </thead>
      <tbody>
        ${assets.map(a => `
          <tr>
            <td><strong>${a.name}</strong></td>
            <td>${a.primitive || a.type}</td>
            <td><span class="badge badge-${a.severity}">${(a.severity || 'unknown').toUpperCase()}</span></td>
            <td><span class="badge badge-${a.quantumSafe === true ? 'safe' : a.quantumSafe === false ? 'vulnerable' : 'partial'}">${String(a.quantumSafe)}</span></td>
            <td>${a.riskScore || a.score || 0}</td>
            <td>${a.occurrences || 1}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="footer">
      <p>🔐 Generated by Crypto Detector CLI v2.0.0</p>
      <p>For more information, visit the GitHub repository</p>
    </div>
  </div>

  <script>
    new Chart(document.getElementById('riskChart'), {
      type: 'doughnut',
      data: {
        labels: ['High Risk', 'Medium Risk', 'Low Risk'],
        datasets: [{
          data: [${high}, ${medium}, ${low}],
          backgroundColor: ['#ef4444', '#f59e0b', '#10b981']
        }]
      },
      options: {
        plugins: {
          legend: { labels: { color: '#fff', font: { size: 14 } } }
        }
      }
    });

    new Chart(document.getElementById('quantumChart'), {
      type: 'bar',
      data: {
        labels: ['Quantum-Safe', 'Vulnerable'],
        datasets: [{
          label: 'Count',
          data: [${qSafe}, ${qVuln}],
          backgroundColor: ['#10b981', '#ef4444']
        }]
      },
      options: {
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: '#fff' },
            grid: { color: 'rgba(255,255,255,0.1)' }
          },
          x: {
            ticks: { color: '#fff' },
            grid: { display: false }
          }
        }
      }
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(`\n📊 Dashboard saved to: ${outputPath}`);
  
  // Automatically open in browser
  openInBrowser(outputPath);
}

/**
 * Print summary statistics
 */
function printSummary(assets: CryptoAsset[]): void {
  const total = assets.length;
  const high = assets.filter(a => a.severity === 'high').length;
  const medium = assets.filter(a => a.severity === 'medium').length;
  const low = assets.filter(a => a.severity === 'low').length;
  const qSafe = assets.filter(a => a.quantumSafe === true).length;
  const qVuln = assets.filter(a => a.quantumSafe === false).length;

  console.log('\n' + '='.repeat(60));
  console.log('📊 SCAN SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Assets Detected: ${total}`);
  console.log(`\nRisk Levels:`);
  console.log(`  🔴 High Risk:    ${high}`);
  console.log(`  🟡 Medium Risk:  ${medium}`);
  console.log(`  🟢 Low Risk:     ${low}`);
  console.log(`\nQuantum Readiness:`);
  console.log(`  ✅ Quantum-Safe:      ${qSafe}`);
  console.log(`  ❌ Quantum-Vulnerable: ${qVuln}`);
  console.log('='.repeat(60) + '\n');
}

/**
 * Command: Scan a single file
 */
program
  .command('scan-file')
  .description('Scan a single file for cryptographic algorithms')
  .argument('<file>', 'File path to scan')
  .option('-o, --output <path>', 'Output directory for reports', './crypto-analysis')
  .option('--no-dashboard', 'Skip dashboard generation')
  .action(async (filePath: string, options) => {
    console.log(`\n🔐 Crypto Detector CLI - File Scan`);
    console.log(`📄 File: ${filePath}\n`);

    const resolvedPath = path.resolve(filePath);
    
    if (!fs.existsSync(resolvedPath)) {
      console.error(`❌ File not found: ${resolvedPath}`);
      process.exit(1);
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      console.error(`❌ Path is not a file: ${resolvedPath}`);
      console.log(`💡 Tip: Use 'crypto-detector scan' for directories`);
      process.exit(1);
    }

    if (!isSupportedFile(resolvedPath)) {
      console.error(`❌ Unsupported file type: ${path.basename(resolvedPath)}`);
      console.log(`\nSupported extensions: .js, .jsx, .ts, .tsx, .py, .java, .cpp, .c, .h, .rs, .go, .cs, .php, .rb, .swift`);
      process.exit(1);
    }

    // Create output directory
    const outputDir = path.resolve(options.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Scan the file
    const assets = scanFiles([resolvedPath]);

    if (assets.length === 0) {
      console.log('\n✅ No cryptographic algorithms detected in file.');
      return;
    }

    // Print summary
    printSummary(assets);

    // Generate CBOM
    const cbomPath = path.join(outputDir, 'cbom-report.json');
    try {
      const cbom = {
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        serialNumber: `urn:uuid:${Date.now()}`,
        version: 1,
        metadata: {
          timestamp: new Date().toISOString(),
          tools: [{
            vendor: 'Syed Shail',
            name: 'Crypto Detector CLI',
            version: '2.0.0'
          }],
          component: {
            type: 'file',
            name: path.basename(resolvedPath),
            version: '1.0.0'
          }
        },
        components: assets.map((a, i) => ({
          type: 'cryptographic-asset',
          'bom-ref': a.id || `asset-${i}`,
          name: a.name,
          cryptoProperties: {
            assetType: a.assetType || 'algorithm',
            algorithmProperties: {
              primitive: a.primitive || a.type || 'unknown'
            },
            quantumSafe: String(a.quantumSafe || 'unknown'),
            severity: a.severity || 'unknown',
            riskScore: a.riskScore || a.score || 0
          }
        }))
      };

      fs.writeFileSync(cbomPath, JSON.stringify(cbom, null, 2));
      console.log(`📦 CBOM saved to: ${cbomPath}`);
    } catch (err: any) {
      console.error(`❌ Failed to write CBOM: ${err.message}`);
    }

    // Generate dashboard
    if (options.dashboard !== false) {
      const dashboardPath = path.join(outputDir, 'dashboard.html');
      generateDashboardHtml(assets, dashboardPath);
    }

    console.log(`\n✅ Analysis complete. Results saved to: ${outputDir}\n`);
  });

/**
 * Command: Scan local directory or file
 */
program
  .command('scan')
  .description('Scan a local directory or file for cryptographic algorithms')
  .argument('<path>', 'Directory or file path to scan')
  .option('-o, --output <path>', 'Output directory for reports', './crypto-analysis')
  .option('--no-dashboard', 'Skip dashboard generation')
  .action(async (targetPath: string, options) => {
    const resolvedPath = path.resolve(targetPath);
    const stat = fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : null;
    
    // If it's a single file, use scan-file logic
    if (stat && stat.isFile()) {
      console.log(`\n🔐 Crypto Detector CLI - File Scan`);
      console.log(`📄 File: ${targetPath}\n`);
    } else {
      console.log(`\n🔐 Crypto Detector CLI - Directory Scan`);
      console.log(`📁 Target: ${targetPath}\n`);
    }

    // Create output directory
    const outputDir = path.resolve(options.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get files to scan (handles both files and directories)
    const files = getFilesToScan(targetPath);
    
    if (files.length === 0) {
      console.log('⚠️  No supported source files found.');
      console.log('Supported extensions: .js, .jsx, .ts, .tsx, .py, .java, .cpp, .c, .h, .rs, .go, .cs, .php, .rb, .swift\n');
      return;
    }

    const assets = scanFiles(files);

    if (assets.length === 0) {
      console.log('\n✅ No cryptographic algorithms detected.');
      return;
    }

    // Print summary
    printSummary(assets);

    // Generate CBOM
    const cbomPath = path.join(outputDir, 'cbom-report.json');
    try {
      const cbom = {
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        serialNumber: `urn:uuid:${Date.now()}`,
        version: 1,
        metadata: {
          timestamp: new Date().toISOString(),
          tools: [{
            vendor: 'Syed Shail',
            name: 'Crypto Detector CLI',
            version: '2.0.0'
          }]
        },
        components: assets.map((a, i) => ({
          type: 'cryptographic-asset',
          'bom-ref': a.id || `asset-${i}`,
          name: a.name,
          cryptoProperties: {
            assetType: a.assetType || 'algorithm',
            algorithmProperties: {
              primitive: a.primitive || a.type || 'unknown'
            },
            quantumSafe: String(a.quantumSafe || 'unknown'),
            severity: a.severity || 'unknown',
            riskScore: a.riskScore || a.score || 0
          }
        }))
      };

      fs.writeFileSync(cbomPath, JSON.stringify(cbom, null, 2));
      console.log(`📦 CBOM saved to: ${cbomPath}`);
    } catch (err: any) {
      console.error(`❌ Failed to write CBOM: ${err.message}`);
    }

    // Generate dashboard
    if (options.dashboard !== false) {
      const dashboardPath = path.join(outputDir, 'dashboard.html');
      generateDashboardHtml(assets, dashboardPath);
    }

    console.log(`\n✅ Analysis complete. Results saved to: ${outputDir}\n`);
  });

/**
 * Command: Scan GitHub repository
 */
program
  .command('scan-github')
  .description('Clone and scan a GitHub repository')
  .argument('<repo-url>', 'GitHub repository URL')
  .option('-o, --output <path>', 'Output directory for reports', './crypto-analysis')
  .option('--no-dashboard', 'Skip dashboard generation')
  .action(async (repoUrl: string, options) => {
    console.log(`\n🔐 Crypto Detector CLI - GitHub Scan`);
    console.log(`🐙 Repository: ${repoUrl}\n`);

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

    // Create temp directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-cli-'));
    console.log(`📂 Cloning to: ${tempDir}`);

    try {
      // Clone repository
      const git = simpleGit();
      console.log(`⬇️  Cloning repository...`);
      await git.clone(normalizedUrl, tempDir);
      console.log(`✅ Repository cloned successfully\n`);

      // Create output directory
      const outputDir = path.resolve(options.output);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Scan files
      const files = walkDir(tempDir);
      const assets = scanFiles(files);

      if (assets.length === 0) {
        console.log('\n✅ No cryptographic algorithms detected.');
        return;
      }

      // Print summary
      printSummary(assets);

      // Generate CBOM
      const cbomPath = path.join(outputDir, 'cbom-report.json');
      try {
        const cbom = {
          bomFormat: 'CycloneDX',
          specVersion: '1.6',
          serialNumber: `urn:uuid:${Date.now()}`,
          version: 1,
          metadata: {
            timestamp: new Date().toISOString(),
            tools: [{
              vendor: 'Syed Shail',
              name: 'Crypto Detector CLI',
              version: '2.0.0'
            }],
            component: {
              type: 'application',
              name: normalizedUrl.split('/').pop()?.replace('.git', '') || 'unknown',
              version: '1.0.0'
            }
          },
          components: assets.map((a, i) => ({
            type: 'cryptographic-asset',
            'bom-ref': a.id || `asset-${i}`,
            name: a.name,
            cryptoProperties: {
              assetType: a.assetType || 'algorithm',
              algorithmProperties: {
                primitive: a.primitive || a.type || 'unknown'
              },
              quantumSafe: String(a.quantumSafe || 'unknown'),
              severity: a.severity || 'unknown',
              riskScore: a.riskScore || a.score || 0
            }
          }))
        };

        fs.writeFileSync(cbomPath, JSON.stringify(cbom, null, 2));
        console.log(`📦 CBOM saved to: ${cbomPath}`);
      } catch (err: any) {
        console.error(`❌ Failed to write CBOM: ${err.message}`);
      }

      // Generate dashboard
      if (options.dashboard !== false) {
        const dashboardPath = path.join(outputDir, 'dashboard.html');
        generateDashboardHtml(assets, dashboardPath);
      }

      console.log(`\n✅ Analysis complete. Results saved to: ${outputDir}\n`);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });

    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}\n`);
      // Cleanup on error
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      process.exit(1);
    }
  });

/**
 * Command: Scan workspace (alias for scan with current directory)
 */
program
  .command('scan-workspace')
  .description('Scan current workspace')
  .option('-o, --output <path>', 'Output directory for reports', './crypto-analysis')
  .option('--no-dashboard', 'Skip dashboard generation')
  .action(async (options) => {
    const cwd = process.cwd();
    console.log(`\n🔐 Crypto Detector CLI - Workspace Scan`);
    console.log(`📁 Workspace: ${cwd}\n`);

    // Create output directory
    const outputDir = path.resolve(options.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Scan files
    const files = walkDir(cwd);
    const assets = scanFiles(files);

    if (assets.length === 0) {
      console.log('\n✅ No cryptographic algorithms detected.');
      return;
    }

    // Print summary
    printSummary(assets);

    // Generate CBOM
    const cbomPath = path.join(outputDir, 'cbom-report.json');
    try {
      const cbom = {
        bomFormat: 'CycloneDX',
        specVersion: '1.6',
        serialNumber: `urn:uuid:${Date.now()}`,
        version: 1,
        metadata: {
          timestamp: new Date().toISOString(),
          tools: [{
            vendor: 'Syed Shail',
            name: 'Crypto Detector CLI',
            version: '2.0.0'
          }]
        },
        components: assets.map((a, i) => ({
          type: 'cryptographic-asset',
          'bom-ref': a.id || `asset-${i}`,
          name: a.name,
          cryptoProperties: {
            assetType: a.assetType || 'algorithm',
            algorithmProperties: {
              primitive: a.primitive || a.type || 'unknown'
            },
            quantumSafe: String(a.quantumSafe || 'unknown'),
            severity: a.severity || 'unknown',
            riskScore: a.riskScore || a.score || 0
          }
        }))
      };

      fs.writeFileSync(cbomPath, JSON.stringify(cbom, null, 2));
      console.log(`📦 CBOM saved to: ${cbomPath}`);
    } catch (err: any) {
      console.error(`❌ Failed to write CBOM: ${err.message}`);
    }

    // Generate dashboard
    if (options.dashboard !== false) {
      const dashboardPath = path.join(outputDir, 'dashboard.html');
      generateDashboardHtml(assets, dashboardPath);
    }

    console.log(`\n✅ Analysis complete. Results saved to: ${outputDir}\n`);
  });

program.parse();

function openInBrowser(outputPath: string) {
  throw new Error('Function not implemented.');
}
