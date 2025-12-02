// src/commands/scanGithubAdvanced.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import { CryptoAsset } from '../parser/types';
import { CodeQLAnalyzer } from '../codeql/codeql-analyzer';
import { DependencyAnalyzer } from '../dependency/dependency-analyzer';
import { writeSarifReport } from '../parser/sarif-writer';
import { generateAndDownloadCbom } from '../parser/report-writer';
import { getIBMStyleDashboard } from '../dashboard-ibm';
import * as parser from '../parser';

interface ScanOptions {
  analyzeDependencies: boolean;
  useCodeQL: boolean;
  generateSARIF: boolean;
  generateCBOM: boolean;
  uploadToCodeScanning: boolean;
}

export async function scanGithubRepoAdvanced() {
  // Get repository URL
  const repoUrlInput = await vscode.window.showInputBox({
    prompt: 'Enter GitHub repository URL',
    placeHolder: 'https://github.com/owner/repo',
    validateInput: (value) => {
      if (!value) return 'Repository URL is required';
      if (!value.includes('github.com')) return 'Must be a GitHub repository URL';
      return null;
    }
  });

  if (!repoUrlInput) {
    return;
  }

  // Parse repository URL
  const urlMatch = repoUrlInput.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!urlMatch) {
    vscode.window.showErrorMessage('Invalid GitHub repository URL');
    return;
  }

  const [, owner, repo] = urlMatch;

  // Get scan options
  const options = await getScanOptions();
  if (!options) {
    return;
  }

  // Get GitHub token if needed
  let token: string | undefined;
  if (options.analyzeDependencies || options.uploadToCodeScanning) {
    token = await vscode.window.showInputBox({
      prompt: 'Enter GitHub Personal Access Token (optional, but recommended)',
      placeHolder: 'ghp_...',
      password: true
    });
  }

  // Start scanning
  await performAdvancedScan(owner, repo, options, token);
}

/**
 * Get scan options from user
 */
async function getScanOptions(): Promise<ScanOptions | null> {
  const quickPick = vscode.window.createQuickPick();
  quickPick.title = 'Select Scan Options';
  quickPick.canSelectMany = true;
  quickPick.items = [
    {
      label: '🔍 Analyze Dependencies',
      description: 'Scan dependency graph for cryptographic usage',
      picked: false
    },
    {
      label: '🛠️ Use CodeQL Analysis',
      description: 'Deep analysis using CodeQL (requires CodeQL CLI)',
      picked: false
    },
    {
      label: '📄 Generate SARIF Report',
      description: 'GitHub Code Scanning compatible format',
      picked: true
    },
    {
      label: '📦 Generate CBOM Report',
      description: 'CycloneDX Cryptographic Bill of Materials',
      picked: true
    },
    {
      label: '☁️ Upload to Code Scanning',
      description: 'Upload results to GitHub (requires token)',
      picked: false
    }
  ];

  return new Promise((resolve) => {
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems;
      quickPick.hide();
      
      resolve({
        analyzeDependencies: selected.some(s => s.label.includes('Dependencies')),
        useCodeQL: selected.some(s => s.label.includes('CodeQL')),
        generateSARIF: selected.some(s => s.label.includes('SARIF')),
        generateCBOM: selected.some(s => s.label.includes('CBOM')),
        uploadToCodeScanning: selected.some(s => s.label.includes('Upload'))
      });
    });

    quickPick.onDidHide(() => {
      resolve(null);
    });

    quickPick.show();
  });
}

/**
 * Perform advanced scan with all selected options
 */
async function performAdvancedScan(
  owner: string,
  repo: string,
  options: ScanOptions,
  token?: string
): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('Crypto Detector - Advanced Scan');
  outputChannel.show(true);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Scanning ${owner}/${repo}`,
      cancellable: true
    },
    async (progress, cancellationToken) => {
      try {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbom-advanced-'));
        const repoUrl = `https://github.com/${owner}/${repo}.git`;
        
        outputChannel.appendLine(`\n${'='.repeat(60)}`);
        outputChannel.appendLine(`🚀 Advanced Crypto Detection Scan`);
        outputChannel.appendLine(`   Repository: ${owner}/${repo}`);
        outputChannel.appendLine(`   Options:`);
        outputChannel.appendLine(`     - Analyze Dependencies: ${options.analyzeDependencies}`);
        outputChannel.appendLine(`     - Use CodeQL: ${options.useCodeQL}`);
        outputChannel.appendLine(`     - Generate SARIF: ${options.generateSARIF}`);
        outputChannel.appendLine(`     - Generate CBOM: ${options.generateCBOM}`);
        outputChannel.appendLine(`${'='.repeat(60)}\n`);

        // Step 1: Clone repository
        progress.report({ message: 'Cloning repository...' });
        outputChannel.appendLine('📥 Cloning repository...');
        
        const git = simpleGit();
        await git.clone(repoUrl, tempDir);
        outputChannel.appendLine(`✅ Repository cloned to ${tempDir}\n`);

        // Step 2: Build analysis matrix
        let repositories = [{ owner, repo, language: 'python' }]; // Default
        
        if (options.analyzeDependencies) {
          progress.report({ message: 'Building dependency graph...' });
          outputChannel.appendLine('📊 Building analysis matrix with dependencies...');
          
          const depAnalyzer = new DependencyAnalyzer(token);
          const matrix = await depAnalyzer.buildAnalysisMatrix(owner, repo, true);
          
          outputChannel.appendLine(`✅ Found ${matrix.length} repositories to analyze:\n`);
          for (const item of matrix) {
            outputChannel.appendLine(`   - ${item.nameWithOwner} (${item.language})`);
          }
          outputChannel.appendLine('');
          
          repositories = matrix.map(m => ({
            owner: m.owner,
            repo: m.repo,
            language: m.language
          }));
        } else {
          // Detect languages in main repo
          const depAnalyzer = new DependencyAnalyzer(token);
          const languages = await depAnalyzer.getRepositoryLanguages(owner, repo);
          repositories = languages.map(l => ({
            owner: l.owner,
            repo: l.repo,
            language: l.language
          }));
        }

        const allResults: CryptoAsset[] = [];

        // Step 3: Analyze each repository
        for (let i = 0; i < repositories.length; i++) {
          if (cancellationToken.isCancellationRequested) {
            outputChannel.appendLine('\n⚠️  Scan cancelled by user');
            break;
          }

          const repoInfo = repositories[i];
          progress.report({
            message: `Analyzing ${repoInfo.owner}/${repoInfo.repo} (${i + 1}/${repositories.length})`,
            increment: (100 / repositories.length)
          });

          outputChannel.appendLine(`\n${'─'.repeat(60)}`);
          outputChannel.appendLine(`📁 Analyzing: ${repoInfo.owner}/${repoInfo.repo} (${repoInfo.language})`);
          outputChannel.appendLine(`${'─'.repeat(60)}`);

          let repoResults: CryptoAsset[] = [];

          // Use CodeQL if enabled and main repo
          if (options.useCodeQL && i === 0) {
            try {
              outputChannel.appendLine('\n🛠️  Running CodeQL analysis...');
              const codeqlAnalyzer = new CodeQLAnalyzer();
              
              // Check if CodeQL is installed
              const isInstalled = await codeqlAnalyzer.isCodeQLInstalled();
              if (isInstalled) {
                repoResults = await codeqlAnalyzer.analyzeRepository(
                  tempDir,
                  repoInfo.language,
                  owner,
                  repo,
                  token
                );
                outputChannel.appendLine(`✅ CodeQL analysis found ${repoResults.length} crypto assets\n`);
              } else {
                outputChannel.appendLine('⚠️  CodeQL CLI not found, falling back to tree-sitter analysis\n');
                repoResults = await scanWithTreeSitter(tempDir, repoInfo.language, outputChannel);
              }
            } catch (err: any) {
              outputChannel.appendLine(`⚠️  CodeQL analysis failed: ${err.message}`);
              outputChannel.appendLine('   Falling back to tree-sitter analysis\n');
              repoResults = await scanWithTreeSitter(tempDir, repoInfo.language, outputChannel);
            }
          } else {
            // Use tree-sitter analysis
            repoResults = await scanWithTreeSitter(tempDir, repoInfo.language, outputChannel);
          }

          outputChannel.appendLine(`✅ Found ${repoResults.length} cryptographic algorithms`);
          allResults.push(...repoResults);
        }

        // Step 4: Generate reports
        outputChannel.appendLine(`\n${'='.repeat(60)}`);
        outputChannel.appendLine('📊 Generating Reports');
        outputChannel.appendLine(`${'='.repeat(60)}\n`);

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const outputDir = workspaceFolder?.uri.fsPath || process.cwd();

        if (options.generateSARIF) {
          progress.report({ message: 'Generating SARIF report...' });
          outputChannel.appendLine('📄 Generating SARIF report...');
          
          const sarifPath = path.join(outputDir, `crypto-scan-${owner}-${repo}.sarif`);
          await writeSarifReport(allResults, sarifPath, `CBOM:${owner}/${repo}`);
          
          outputChannel.appendLine(`✅ SARIF report: ${sarifPath}\n`);
        }

        if (options.generateCBOM) {
          progress.report({ message: 'Generating CBOM report...' });
          outputChannel.appendLine('📦 Generating CBOM report...');
          
          await generateAndDownloadCbom(allResults);
          outputChannel.appendLine(`✅ CBOM report generated\n`);
        }

        // Step 5: Upload to Code Scanning (if enabled)
        if (options.uploadToCodeScanning && token) {
          progress.report({ message: 'Uploading to GitHub Code Scanning...' });
          outputChannel.appendLine('☁️  Uploading to GitHub Code Scanning...');
          
          try {
            await uploadToCodeScanning(owner, repo, allResults, token, outputChannel);
            outputChannel.appendLine('✅ Results uploaded to GitHub Code Scanning\n');
          } catch (err: any) {
            outputChannel.appendLine(`⚠️  Failed to upload: ${err.message}\n`);
          }
        }

        // Step 6: Show dashboard
        progress.report({ message: 'Generating dashboard...' });
        
        const panel = vscode.window.createWebviewPanel(
          'cryptoDashboard',
          `CBOM Analysis - ${owner}/${repo}`,
          vscode.ViewColumn.One,
          { enableScripts: true, retainContextWhenHidden: true }
        );

        panel.webview.html = getIBMStyleDashboard(allResults);

        panel.webview.onDidReceiveMessage(async (message) => {
          if (message.command === 'generateCbom') {
            await generateAndDownloadCbom(allResults);
          }
        });

        // Summary
        outputChannel.appendLine(`\n${'='.repeat(60)}`);
        outputChannel.appendLine('✅ Scan Complete!');
        outputChannel.appendLine(`${'='.repeat(60)}`);
        outputChannel.appendLine(`\n📊 Summary:`);
        outputChannel.appendLine(`   Total Repositories Scanned: ${repositories.length}`);
        outputChannel.appendLine(`   Total Crypto Assets Found: ${allResults.length}`);
        outputChannel.appendLine(`   High Risk: ${allResults.filter(a => a.severity === 'high').length}`);
        outputChannel.appendLine(`   Medium Risk: ${allResults.filter(a => a.severity === 'medium').length}`);
        outputChannel.appendLine(`   Low Risk: ${allResults.filter(a => a.severity === 'low').length}`);
        outputChannel.appendLine(`   Quantum-Safe: ${allResults.filter(a => a.quantumSafe === true).length}`);
        outputChannel.appendLine(`   Quantum-Vulnerable: ${allResults.filter(a => a.quantumSafe === false).length}`);
        outputChannel.appendLine('');

        vscode.window.showInformationMessage(
          `✅ Scan complete! Found ${allResults.length} cryptographic assets.`,
          'View Dashboard',
          'View Output'
        ).then(choice => {
          if (choice === 'View Output') {
            outputChannel.show();
          } else if (choice === 'View Dashboard') {
            panel.reveal();
          }
        });

      } catch (err: any) {
        outputChannel.appendLine(`\n❌ Error: ${err.message}`);
        vscode.window.showErrorMessage(`Scan failed: ${err.message}`);
      }
    }
  );
}

/**
 * Scan repository using tree-sitter parsers
 */
async function scanWithTreeSitter(
  repoPath: string,
  language: string,
  outputChannel: vscode.OutputChannel
): Promise<CryptoAsset[]> {
  outputChannel.appendLine('🌳 Running tree-sitter analysis...');
  
  const extensions: Record<string, string[]> = {
    'python': ['.py'],
    'java': ['.java'],
    'javascript': ['.js', '.jsx', '.ts', '.tsx'],
    'c': ['.c', '.h'],
    'cpp': ['.cpp', '.cc', '.cxx', '.hpp', '.h']
  };

  const exts = extensions[language] || [];
  const files = walkDirectory(repoPath, exts);
  
  outputChannel.appendLine(`   Found ${files.length} files to scan`);

  const results: CryptoAsset[] = [];
  let processed = 0;

  for (const file of files) {
    try {
      const uri = vscode.Uri.file(file);
      const assets = await parser.detectInDocument(uri);
      results.push(...assets);
      processed++;
      
      if (processed % 10 === 0) {
        outputChannel.appendLine(`   Processed ${processed}/${files.length} files...`);
      }
    } catch (err: any) {
      outputChannel.appendLine(`   ⚠️  Failed to scan ${path.basename(file)}: ${err.message}`);
    }
  }

  return results;
}

/**
 * Walk directory and find files with given extensions
 */
function walkDirectory(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  const ignoreDirs = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'target', '.codeql']);

  function walk(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Upload results to GitHub Code Scanning
 */
async function uploadToCodeScanning(
  owner: string,
  repo: string,
  assets: CryptoAsset[],
  token: string,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const { Octokit } = require('@octokit/rest');
  const octokit = new Octokit({ auth: token });

  // Generate SARIF
  const tempSarif = path.join(os.tmpdir(), `crypto-scan-${Date.now()}.sarif`);
  await writeSarifReport(assets, tempSarif, `crypto-detector`);

  // Read SARIF
  const sarifContent = fs.readFileSync(tempSarif, 'utf8');
  const sarifBase64 = Buffer.from(sarifContent).toString('base64');

  // Get commit SHA
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const defaultBranch = repoData.default_branch;
  const { data: branchData } = await octokit.repos.getBranch({ owner, repo, branch: defaultBranch });
  const commitSha = branchData.commit.sha;

  // Upload
  await octokit.codeScanning.uploadSarif({
    owner,
    repo,
    commit_sha: commitSha,
    ref: `refs/heads/${defaultBranch}`,
    sarif: sarifBase64,
    tool_name: 'crypto-detector'
  });

  outputChannel.appendLine(`   Uploaded to: https://github.com/${owner}/${repo}/security/code-scanning`);
}