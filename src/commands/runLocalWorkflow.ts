// src/commands/runLocalWorkflow.ts
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { CryptoAsset } from '../parser/types';
import * as parser from '../parser';

interface LanguageStats {
  language: string;
  fileCount: number;
  byteCount: number;
  detections: CryptoAsset[];
}

interface WorkflowMatrix {
  languages: string[];
  stats: LanguageStats[];
  totalFiles: number;
  totalBytes: number;
  totalDetections: number;
}

interface DependencyInfo {
  name: string;
  version?: string;
  source: string;
  detections: CryptoAsset[];
}

/**
 * Test function to verify CBOM generation
 */
export async function testCBOMGeneration() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const outputDir = path.join(workspaceRoot, '.cbom-analysis');

  try {
    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });
    console.log(`Output directory created: ${outputDir}`);

    // Create minimal test CBOM
    const testCBOM = {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      serialNumber: `urn:uuid:${require('crypto').randomUUID()}`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: [{
          vendor: 'Test',
          name: 'CBOM Test',
          version: '1.0.0'
        }]
      },
      components: [{
        type: 'cryptographic-asset',
        'bom-ref': 'test-1',
        name: 'SHA256',
        cryptoProperties: {
          assetType: 'algorithm',
          algorithmProperties: { primitive: 'hash' }
        }
      }]
    };

    const cbomPath = path.join(outputDir, 'test-cbom.json');
    await fs.writeFile(cbomPath, JSON.stringify(testCBOM, null, 2), 'utf8');
    
    vscode.window.showInformationMessage(`✅ Test CBOM created at: ${cbomPath}`);
    
    // Open the file
    const doc = await vscode.workspace.openTextDocument(cbomPath);
    await vscode.window.showTextDocument(doc);
    
  } catch (err: any) {
    vscode.window.showErrorMessage(`Test failed: ${err.message}`);
    console.error('Test error:', err);
  }
}

/**
 * Main command: Run complete CBOM workflow locally
 */
export async function runLocalWorkflow() {
  // Ask user: local workspace or GitHub repo?
  const choice = await vscode.window.showQuickPick(
    [
      { label: '📁 Current Workspace', value: 'local' },
      { label: '🐙 GitHub Repository', value: 'github' }
    ],
    { placeHolder: 'Analyze current workspace or clone a GitHub repository?' }
  );

  if (!choice) return;

  if (choice.value === 'github') {
    await runWorkflowOnGitHub();
    return;
  }

  // Local workspace analysis
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  await runWorkflowOnDirectory(workspaceRoot);
}

/**
 * Run workflow on a GitHub repository
 */
async function runWorkflowOnGitHub() {
  const repoUrl = await vscode.window.showInputBox({
    prompt: 'Enter GitHub repository URL',
    placeHolder: 'https://github.com/owner/repository',
    validateInput: (value) => {
      if (!value) return 'URL is required';
      if (!value.includes('github.com')) return 'Must be a GitHub URL';
      return null;
    }
  });

  if (!repoUrl) return;

  // Import simpleGit
  const simpleGit = (await import('simple-git')).default;
  const os = (await import('os')).default;
  const fsSync = (await import('fs')).default;

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

  const tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'cbom-workflow-'));
  
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '🐙 Cloning GitHub Repository',
      cancellable: true
    },
    async (progress, token) => {
      try {
        progress.report({ message: `Cloning ${normalizedUrl}...` });
        
        const git = simpleGit();
        await git.clone(normalizedUrl, tempDir);

        progress.report({ message: 'Repository cloned, starting analysis...' });

        // Run workflow on cloned directory
        await runWorkflowOnDirectory(tempDir, true);

        // Cleanup
        setTimeout(() => {
          try {
            fsSync.rmSync(tempDir, { recursive: true, force: true });
          } catch (err) {
            console.warn('Failed to cleanup temp directory:', err);
          }
        }, 5000);

      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to clone repository: ${err.message}`);
        // Cleanup on error
        try {
          fsSync.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    }
  );
}

/**
 * Run workflow on a specific directory
 */
async function runWorkflowOnDirectory(workspaceRoot: string, isTemp: boolean = false) {
  const outputDir = path.join(workspaceRoot, '.cbom-analysis');

  // Create output directory (critical!)
  try {
    console.log(`[runWorkflowOnDirectory] Creating output directory: ${outputDir}`);
    await fs.mkdir(outputDir, { recursive: true });
    console.log(`[runWorkflowOnDirectory] Output directory created/verified`);
  } catch (err) {
    console.error('[runWorkflowOnDirectory] Failed to create output directory:', err);
    vscode.window.showErrorMessage(`Failed to create output directory: ${err}`);
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '🔐 Running CBOM Workflow Analysis',
      cancellable: true
    },
    async (progress, token) => {
      try {
        console.log('[Workflow] Starting workflow...');
        
        // Step 1: Build language matrix
        progress.report({ message: 'Step 1/5: Building language matrix...' });
        console.log('[Workflow] Step 1: Building matrix...');
        const matrix = await buildLanguageMatrix(workspaceRoot, token);
        console.log(`[Workflow] Matrix built: ${matrix.languages.length} languages found`);
        
        if (token.isCancellationRequested) {
          console.log('[Workflow] Cancelled after step 1');
          return;
        }

        // Save matrix
        await fs.writeFile(
          path.join(outputDir, 'language-matrix.json'),
          JSON.stringify(matrix, null, 2),
          'utf8'
        );
        console.log('[Workflow] Matrix saved');

        // Step 2: Analyze dependencies
        progress.report({ message: 'Step 2/5: Analyzing dependencies...' });
        console.log('[Workflow] Step 2: Analyzing dependencies...');
        const dependencies = await analyzeDependencies(workspaceRoot, token);
        console.log(`[Workflow] Found ${dependencies.length} dependencies`);
        
        if (token.isCancellationRequested) {
          console.log('[Workflow] Cancelled after step 2');
          return;
        }

        // Step 3: Scan all files
        progress.report({ message: 'Step 3/5: Scanning all files...' });
        console.log('[Workflow] Step 3: Scanning files...');
        const allDetections = await scanAllFiles(workspaceRoot, matrix, progress, token);
        console.log(`[Workflow] Found ${allDetections.length} detections`);
        
        if (token.isCancellationRequested) {
          console.log('[Workflow] Cancelled after step 3');
          return;
        }

        // Step 4: Generate comprehensive CBOM
        progress.report({ message: 'Step 4/5: Generating CBOM report...' });
        console.log('[Workflow] Step 4: Generating CBOM...');
        await generateComprehensiveCBOM(
          allDetections,
          matrix,
          dependencies,
          outputDir,
          workspaceRoot
        );
        console.log('[Workflow] CBOM generated');

        // Step 5: Create summary reports
        progress.report({ message: 'Step 5/5: Creating summary reports...' });
        console.log('[Workflow] Step 5: Creating summaries...');
        await createSummaryReports(allDetections, matrix, dependencies, outputDir);
        console.log('[Workflow] Summaries created');

        // Show completion message
        console.log('[Workflow] Workflow complete!');
        
        // Check if files were actually created
        const cbomPath = path.join(outputDir, 'cbom-report.json');
        const summaryPath = path.join(outputDir, 'SUMMARY.md');
        const csvPath = path.join(outputDir, 'detections.csv');
        
        const cbomExists = fsSync.existsSync(cbomPath);
        const summaryExists = fsSync.existsSync(summaryPath);
        const csvExists = fsSync.existsSync(csvPath);
        
        console.log('[Workflow] Files created:');
        console.log(`  - cbom-report.json: ${cbomExists}`);
        console.log(`  - SUMMARY.md: ${summaryExists}`);
        console.log(`  - detections.csv: ${csvExists}`);
        
        if (!cbomExists || !summaryExists || !csvExists) {
          vscode.window.showWarningMessage(
            `⚠️ Some output files were not created. Check: ${outputDir}`
          );
        }
        
        const viewReport = 'View Dashboard';
        const openCBOM = 'Open CBOM File';
        const openFolder = 'Open Folder';
        const choice = await vscode.window.showInformationMessage(
          `✅ CBOM Workflow Complete!\n\nFound ${allDetections.length} assets across ${matrix.languages.length} languages.\n\nOutput saved to: ${outputDir}`,
          viewReport,
          openCBOM,
          openFolder
        );

        if (choice === viewReport) {
          await showWorkflowDashboard(allDetections, matrix, dependencies);
        } else if (choice === openCBOM) {
          if (cbomExists) {
            const doc = await vscode.workspace.openTextDocument(cbomPath);
            await vscode.window.showTextDocument(doc);
          } else {
            vscode.window.showErrorMessage('CBOM file not found!');
          }
        } else if (choice === openFolder) {
          if (!isTemp) {
            await vscode.commands.executeCommand(
              'revealFileInOS',
              vscode.Uri.file(outputDir)
            );
          } else {
            // For temp directories, show dashboard instead
            await showWorkflowDashboard(allDetections, matrix, dependencies);
          }
        }
      } catch (err: any) {
        console.error('[Workflow] Error:', err);
        vscode.window.showErrorMessage(`Workflow failed: ${err.message}`);
      }
    }
  );
}

/**
 * Build a matrix of languages and their statistics
 */
async function buildLanguageMatrix(
  workspaceRoot: string,
  token: vscode.CancellationToken
): Promise<WorkflowMatrix> {
  const languageExtensions: Record<string, string[]> = {
    python: ['.py'],
    javascript: ['.js', '.jsx', '.mjs'],
    typescript: ['.ts', '.tsx'],
    java: ['.java'],
    cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.h'],
    c: ['.c', '.h'],
    csharp: ['.cs'],
    go: ['.go'],
    rust: ['.rs'],
    php: ['.php'],
    ruby: ['.rb'],
    swift: ['.swift']
  };

  const stats: Map<string, LanguageStats> = new Map();
  let totalFiles = 0;
  let totalBytes = 0;

  // Walk directory tree
  async function walkDir(dir: string) {
    if (token.isCancellationRequested) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (token.isCancellationRequested) return;

      const fullPath = path.join(dir, entry.name);

      // Skip ignored directories
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue;
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        
        // Find matching language
        for (const [lang, extensions] of Object.entries(languageExtensions)) {
          if (extensions.includes(ext)) {
            const fileStats = await fs.stat(fullPath);
            
            if (!stats.has(lang)) {
              stats.set(lang, {
                language: lang,
                fileCount: 0,
                byteCount: 0,
                detections: []
              });
            }

            const langStats = stats.get(lang)!;
            langStats.fileCount++;
            langStats.byteCount += fileStats.size;
            totalFiles++;
            totalBytes += fileStats.size;
            break;
          }
        }
      }
    }
  }

  await walkDir(workspaceRoot);

  // Filter languages with minimum threshold (5KB)
  const filteredStats = Array.from(stats.values())
    .filter(s => s.byteCount >= 5000)
    .sort((a, b) => b.byteCount - a.byteCount);

  return {
    languages: filteredStats.map(s => s.language),
    stats: filteredStats,
    totalFiles,
    totalBytes,
    totalDetections: 0
  };
}

/**
 * Analyze package dependencies for crypto usage
 */
async function analyzeDependencies(
  workspaceRoot: string,
  token: vscode.CancellationToken
): Promise<DependencyInfo[]> {
  const dependencies: DependencyInfo[] = [];

  // Check package.json (Node.js)
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  if (fsSync.existsSync(packageJsonPath)) {
    try {
      const content = await fs.readFile(packageJsonPath, 'utf8');
      const pkg = JSON.parse(content);
      
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
      };

      // Known crypto packages
      const cryptoPackages = [
        'crypto', 'crypto-js', 'node-forge', 'bcrypt', 'argon2',
        'jsonwebtoken', 'jose', 'tweetnacl', 'libsodium-wrappers',
        'elliptic', 'secp256k1', 'kyber', 'dilithium', 'falcon'
      ];

      for (const [name, version] of Object.entries(allDeps)) {
        if (cryptoPackages.some(cp => name.includes(cp))) {
          dependencies.push({
            name,
            version: version as string,
            source: 'package.json',
            detections: []
          });
        }
      }
    } catch (err) {
      console.warn('Failed to parse package.json:', err);
    }
  }

  // Check requirements.txt (Python)
  const requirementsPath = path.join(workspaceRoot, 'requirements.txt');
  if (fsSync.existsSync(requirementsPath)) {
    try {
      const content = await fs.readFile(requirementsPath, 'utf8');
      const lines = content.split('\n');

      const cryptoPackages = [
        'cryptography', 'pycrypto', 'pycryptodome', 'nacl',
        'hashlib', 'hmac', 'secrets', 'pyopenssl'
      ];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(/^([a-zA-Z0-9_-]+)(==|>=|<=)?(.+)?$/);
        if (match) {
          const [, name, , version] = match;
          if (cryptoPackages.some(cp => name.toLowerCase().includes(cp))) {
            dependencies.push({
              name,
              version,
              source: 'requirements.txt',
              detections: []
            });
          }
        }
      }
    } catch (err) {
      console.warn('Failed to parse requirements.txt:', err);
    }
  }

  // Check pom.xml (Java)
  const pomPath = path.join(workspaceRoot, 'pom.xml');
  if (fsSync.existsSync(pomPath)) {
    try {
      const content = await fs.readFile(pomPath, 'utf8');
      
      const cryptoLibs = [
        'bouncycastle', 'javax.crypto', 'jasypt', 'google-tink'
      ];

      for (const lib of cryptoLibs) {
        if (content.includes(lib)) {
          dependencies.push({
            name: lib,
            source: 'pom.xml',
            detections: []
          });
        }
      }
    } catch (err) {
      console.warn('Failed to parse pom.xml:', err);
    }
  }

  return dependencies;
}

/**
 * Scan all files in the workspace
 */
async function scanAllFiles(
  workspaceRoot: string,
  matrix: WorkflowMatrix,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken
): Promise<CryptoAsset[]> {
  const allDetections: CryptoAsset[] = [];
  let filesScanned = 0;

  for (const langStat of matrix.stats) {
    if (token.isCancellationRequested) break;

    progress.report({ 
      message: `Scanning ${langStat.language} files (${filesScanned}/${matrix.totalFiles})...` 
    });

    // Find all files for this language
    const extensions = getExtensionsForLanguage(langStat.language);
    const pattern = `**/*.{${extensions.map(e => e.slice(1)).join(',')}}`;
    
    const files = await vscode.workspace.findFiles(
      pattern,
      '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**}'
    );

    for (const uri of files) {
      if (token.isCancellationRequested) break;

      try {
        const detections = await parser.detectInDocument(uri);
        allDetections.push(...detections);
        langStat.detections.push(...detections);
        filesScanned++;

        if (filesScanned % 10 === 0) {
          progress.report({ 
            message: `Scanning ${langStat.language} files (${filesScanned}/${matrix.totalFiles})...` 
          });
        }
      } catch (err) {
        console.warn(`Failed to scan ${uri.fsPath}:`, err);
      }
    }
  }

  matrix.totalDetections = allDetections.length;
  return allDetections;
}

/**
 * Generate comprehensive CBOM report
 */
async function generateComprehensiveCBOM(
  detections: CryptoAsset[],
  matrix: WorkflowMatrix,
  dependencies: DependencyInfo[],
  outputDir: string,
  workspaceRoot: string
) {
  try {
    console.log('[generateComprehensiveCBOM] Starting...');
    const crypto = require('crypto');
    
    const cbom = {
      bomFormat: 'CycloneDX',
      specVersion: '1.6',
      serialNumber: `urn:uuid:${crypto.randomUUID()}`,
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        tools: [{
          vendor: 'Syed Shail',
          name: 'Crypto Detector - Local Workflow',
          version: '1.0.0'
        }],
        component: {
          type: 'application',
          name: path.basename(workspaceRoot),
          version: '1.0.0'
        },
        properties: [
          { name: 'analysis:languages', value: matrix.languages.join(', ') },
          { name: 'analysis:totalFiles', value: String(matrix.totalFiles) },
          { name: 'analysis:totalBytes', value: String(matrix.totalBytes) },
          { name: 'analysis:timestamp', value: new Date().toISOString() }
        ]
      },
      components: [
        // Main cryptographic assets
        ...detections.map((d, i) => ({
          type: 'cryptographic-asset',
          'bom-ref': d.id || `asset-${i}`,
          name: d.name || 'Unknown',
          cryptoProperties: {
            assetType: d.assetType || 'algorithm',
            algorithmProperties: {
              primitive: d.primitive || d.type || 'unknown',
              cryptoFunctions: [d.description || 'unknown']
            },
            quantumSafe: String(d.quantumSafe || 'unknown'),
            severity: d.severity || 'unknown',
            riskScore: d.riskScore || d.score || 0
          },
          evidence: {
            occurrences: d.detectionContexts?.map(ctx => ({
              location: ctx.filePath,
              lineNumbers: ctx.lineNumbers,
              snippet: (ctx.snippet || '').substring(0, 300)
            })) || []
          }
        })),
        // Dependencies
        ...dependencies.map((dep, i) => ({
          type: 'library',
          'bom-ref': `dep-${i}`,
          name: dep.name,
          version: dep.version,
          properties: [
            { name: 'source', value: dep.source }
          ]
        }))
      ],
      dependencies: dependencies.map((dep, i) => ({
        ref: `dep-${i}`,
        dependsOn: []
      })),
      statistics: {
        totalDetected: detections.length,
        highRisk: detections.filter(d => d.severity === 'high').length,
        mediumRisk: detections.filter(d => d.severity === 'medium').length,
        lowRisk: detections.filter(d => d.severity === 'low').length,
        quantumSafe: detections.filter(d => d.quantumSafe === true).length,
        quantumVulnerable: detections.filter(d => d.quantumSafe === false).length,
        byLanguage: matrix.stats.map(s => ({
          language: s.language,
          detections: s.detections.length,
          files: s.fileCount
        }))
      }
    };

    const cbomPath = path.join(outputDir, 'cbom-report.json');
    const cbomContent = JSON.stringify(cbom, null, 2);
    
    console.log(`[generateComprehensiveCBOM] Writing to: ${cbomPath}`);
    console.log(`[generateComprehensiveCBOM] Content length: ${cbomContent.length} bytes`);
    
    await fs.writeFile(cbomPath, cbomContent, 'utf8');
    
    // Verify the file was written
    const stats = await fs.stat(cbomPath);
    console.log(`[generateComprehensiveCBOM] File written successfully: ${stats.size} bytes`);
    
  } catch (err) {
    console.error('[generateComprehensiveCBOM] Error:', err);
    throw err;
  }
}

/**
 * Create human-readable summary reports
 */
async function createSummaryReports(
  detections: CryptoAsset[],
  matrix: WorkflowMatrix,
  dependencies: DependencyInfo[],
  outputDir: string
) {
  try {
    console.log('[createSummaryReports] Starting...');
    
    // Markdown summary
    let markdown = `# 🔐 Cryptographic Bill of Materials\n\n`;
    markdown += `**Generated:** ${new Date().toLocaleString()}\n\n`;
    markdown += `## Summary Statistics\n\n`;
    markdown += `- **Total Assets:** ${detections.length}\n`;
    markdown += `- **Languages Analyzed:** ${matrix.languages.join(', ')}\n`;
    markdown += `- **Files Scanned:** ${matrix.totalFiles}\n`;
    markdown += `- **Dependencies:** ${dependencies.length}\n\n`;

    markdown += `## Risk Breakdown\n\n`;
    markdown += `| Severity | Count | Percentage |\n`;
    markdown += `|----------|-------|------------|\n`;
    
    const high = detections.filter(d => d.severity === 'high').length;
    const medium = detections.filter(d => d.severity === 'medium').length;
    const low = detections.filter(d => d.severity === 'low').length;
    const total = detections.length || 1;

    markdown += `| 🔴 High | ${high} | ${((high / total) * 100).toFixed(1)}% |\n`;
    markdown += `| 🟡 Medium | ${medium} | ${((medium / total) * 100).toFixed(1)}% |\n`;
    markdown += `| 🟢 Low | ${low} | ${((low / total) * 100).toFixed(1)}% |\n\n`;

    markdown += `## Quantum Readiness\n\n`;
    const qSafe = detections.filter(d => d.quantumSafe === true).length;
    const qVuln = detections.filter(d => d.quantumSafe === false).length;
    const qPartial = detections.filter(d => d.quantumSafe === 'partial').length;

    markdown += `- ✅ **Quantum-Safe:** ${qSafe}\n`;
    markdown += `- ⚠️ **Partial Safety:** ${qPartial}\n`;
    markdown += `- ❌ **Quantum-Vulnerable:** ${qVuln}\n\n`;

    markdown += `## Language Breakdown\n\n`;
    markdown += `| Language | Files | Detections |\n`;
    markdown += `|----------|-------|------------|\n`;
    
    for (const stat of matrix.stats) {
      markdown += `| ${stat.language} | ${stat.fileCount} | ${stat.detections.length} |\n`;
    }

    markdown += `\n## Top Findings\n\n`;
    markdown += `| Algorithm | Type | Severity | Quantum-Safe | Occurrences |\n`;
    markdown += `|-----------|------|----------|--------------|-------------|\n`;

    detections.slice(0, 20).forEach(d => {
      markdown += `| ${d.name} | ${d.primitive || d.type} | ${d.severity} | ${d.quantumSafe} | ${d.occurrences || 1} |\n`;
    });

    console.log('[createSummaryReports] Writing SUMMARY.md...');
    await fs.writeFile(path.join(outputDir, 'SUMMARY.md'), markdown, 'utf8');
    console.log('[createSummaryReports] SUMMARY.md written');

    // CSV export
    console.log('[createSummaryReports] Creating CSV...');
    let csv = 'Algorithm,Type,Severity,Quantum-Safe,Risk Score,Occurrences,File,Line\n';
    
    for (const d of detections) {
      try {
        const file = (d.detectionContexts?.[0]?.filePath || 'unknown').replace(/"/g, '""');
        const line = d.detectionContexts?.[0]?.lineNumbers?.[0] || 0;
        const name = (d.name || 'unknown').replace(/"/g, '""');
        const type = (d.primitive || d.type || 'unknown').replace(/"/g, '""');
        
        csv += `"${name}","${type}","${d.severity || 'unknown'}","${d.quantumSafe || 'unknown'}",${d.riskScore || 0},${d.occurrences || 1},"${file}",${line}\n`;
      } catch (err) {
        console.warn('[createSummaryReports] Error processing detection for CSV:', err);
      }
    }

    console.log('[createSummaryReports] Writing detections.csv...');
    await fs.writeFile(path.join(outputDir, 'detections.csv'), csv, 'utf8');
    console.log('[createSummaryReports] CSV written');
    
    console.log('[createSummaryReports] Complete!');
  } catch (err) {
    console.error('[createSummaryReports] Error:', err);
    throw err;
  }
}

/**
 * Show interactive workflow dashboard
 */
async function showWorkflowDashboard(
  detections: CryptoAsset[],
  matrix: WorkflowMatrix,
  dependencies: DependencyInfo[]
) {
  const panel = vscode.window.createWebviewPanel(
    'cbomWorkflow',
    '🔐 CBOM Workflow Results',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = getWorkflowDashboardHtml(detections, matrix, dependencies);
}

/**
 * Helper functions
 */
function shouldSkipDirectory(name: string): boolean {
  const skipDirs = [
    'node_modules', '.git', 'dist', 'build', 'out',
    'target', '.vscode', '.idea', '__pycache__',
    'venv', 'env', '.env', 'bower_components'
  ];
  return skipDirs.includes(name);
}

function getExtensionsForLanguage(language: string): string[] {
  const map: Record<string, string[]> = {
    python: ['.py'],
    javascript: ['.js', '.jsx', '.mjs'],
    typescript: ['.ts', '.tsx'],
    java: ['.java'],
    cpp: ['.cpp', '.cc', '.cxx', '.hpp'],
    c: ['.c', '.h'],
    csharp: ['.cs'],
    go: ['.go'],
    rust: ['.rs'],
    php: ['.php'],
    ruby: ['.rb'],
    swift: ['.swift']
  };
  return map[language] || [];
}

function getWorkflowDashboardHtml(
  detections: CryptoAsset[],
  matrix: WorkflowMatrix,
  dependencies: DependencyInfo[]
): string {
  const detectionsJson = JSON.stringify(detections);
  const matrixJson = JSON.stringify(matrix);
  const depsJson = JSON.stringify(dependencies);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>CBOM Workflow Results</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: system-ui, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      padding: 20px;
      margin: 0;
    }
    .header {
      background: linear-gradient(135deg, #0f62fe 0%, #001d6c 100%);
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 30px;
    }
    h1 { margin: 0 0 10px 0; color: white; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: #161b22;
      padding: 20px;
      border-radius: 8px;
      border: 1px solid #30363d;
    }
    .stat-value {
      font-size: 48px;
      font-weight: bold;
      color: #58a6ff;
    }
    .stat-label {
      color: #8b949e;
      margin-top: 8px;
    }
    .charts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 24px;
      margin-bottom: 30px;
    }
    .chart-card {
      background: #161b22;
      padding: 20px;
      border-radius: 8px;
      border: 1px solid #30363d;
    }
    canvas {
      max-height: 300px !important;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #161b22;
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #30363d;
    }
    th {
      background: #21262d;
      color: #58a6ff;
      font-weight: 600;
    }
    tr:hover {
      background: #1f2937;
    }
    .severity-high { color: #f85149; }
    .severity-medium { color: #f0ad4e; }
    .severity-low { color: #3fb950; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔐 CBOM Workflow Analysis Complete</h1>
    <p>Full cryptographic inventory and dependency analysis</p>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${detections.length}</div>
      <div class="stat-label">Total Assets</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${matrix.languages.length}</div>
      <div class="stat-label">Languages</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${matrix.totalFiles}</div>
      <div class="stat-label">Files Scanned</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${dependencies.length}</div>
      <div class="stat-label">Dependencies</div>
    </div>
  </div>

  <div class="charts">
    <div class="chart-card">
      <h3>Risk Distribution</h3>
      <canvas id="riskChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Language Breakdown</h3>
      <canvas id="langChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Quantum Readiness</h3>
      <canvas id="quantumChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Top Risk Algorithms</h3>
      <canvas id="topRiskChart"></canvas>
    </div>
  </div>

  <h2>Detailed Findings</h2>
  <table id="detailsTable">
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
    <tbody></tbody>
  </table>

  <script>
    const detections = ${detectionsJson};
    const matrix = ${matrixJson};
    const deps = ${depsJson};

    // Risk chart
    const high = detections.filter(d => d.severity === 'high').length;
    const medium = detections.filter(d => d.severity === 'medium').length;
    const low = detections.filter(d => d.severity === 'low').length;

    new Chart(document.getElementById('riskChart'), {
      type: 'doughnut',
      data: {
        labels: ['High', 'Medium', 'Low'],
        datasets: [{
          data: [high, medium, low],
          backgroundColor: ['#f85149', '#f0ad4e', '#3fb950']
        }]
      }
    });

    // Language chart
    new Chart(document.getElementById('langChart'), {
      type: 'bar',
      data: {
        labels: matrix.stats.map(s => s.language),
        datasets: [{
          label: 'Detections',
          data: matrix.stats.map(s => s.detections.length),
          backgroundColor: '#58a6ff'
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

    // Quantum chart
    const qSafe = detections.filter(d => d.quantumSafe === true).length;
    const qVuln = detections.filter(d => d.quantumSafe === false).length;
    const qPartial = detections.filter(d => d.quantumSafe === 'partial').length;

    new Chart(document.getElementById('quantumChart'), {
      type: 'pie',
      data: {
        labels: ['Safe', 'Vulnerable', 'Partial'],
        datasets: [{
          data: [qSafe, qVuln, qPartial],
          backgroundColor: ['#3fb950', '#f85149', '#f0ad4e']
        }]
      }
    });

    // Top risk chart
    const topRisk = [...detections]
      .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))
      .slice(0, 10);

    new Chart(document.getElementById('topRiskChart'), {
      type: 'bar',
      data: {
        labels: topRisk.map(d => d.name),
        datasets: [{
          label: 'Risk Score',
          data: topRisk.map(d => d.riskScore || 0),
          backgroundColor: '#f85149'
        }]
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: { beginAtZero: true, ticks: { color: '#e6edf3' } },
          y: { ticks: { color: '#e6edf3' } }
        },
        plugins: { legend: { display: false } }
      }
    });

    // Populate table
    const tbody = document.querySelector('#detailsTable tbody');
    detections.forEach(d => {
      const tr = document.createElement('tr');
      tr.innerHTML = \`
        <td>\${d.name}</td>
        <td>\${d.primitive || d.type}</td>
        <td class="severity-\${d.severity}">\${d.severity?.toUpperCase()}</td>
        <td>\${d.quantumSafe}</td>
        <td>\${d.riskScore || 0}</td>
        <td>\${d.occurrences || 1}</td>
      \`;
      tbody.appendChild(tr);
    });
  </script>
</body>
</html>`;
}