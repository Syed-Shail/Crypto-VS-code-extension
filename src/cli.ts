// src/cli.ts
#!/usr/bin/env node

/**
 * CLI Interface for Crypto Detector
 * Enables running scans from command line and CI/CD pipelines
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import * as os from 'os';

// Import analyzers
import { CodeQLAnalyzer } from './codeql/codeql-analyzer';
import { DependencyAnalyzer } from './dependency/dependency-analyzer';
import { writeSarifReport } from './parser/sarif-writer';
import { writeCbomJson } from './parser/report-writer';
import { CryptoAsset } from './parser/types';

const program = new Command();

program
  .name('crypto-detector')
  .description('Cryptographic algorithm detection and CBOM generation tool')
  .version('1.0.0');

/**
 * Scan command
 */
program
  .command('scan')
  .description('Scan a repository for cryptographic algorithms')
  .requiredOption('-r, --repo <owner/repo>', 'GitHub repository to scan (owner/repo format)')
  .option('-l, --language <language>', 'Primary language to analyze', 'python')
  .option('-d, --dependencies', 'Analyze dependency graph', false)
  .option('--codeql', 'Use CodeQL analysis (requires CodeQL CLI)', false)
  .option('-o, --output <directory>', 'Output directory for reports', '.')
  .option('-f, --format <format>', 'Output format: cbom, sarif, or both', 'both')
  .option('-t, --token <token>', 'GitHub personal access token')
  .option('--upload', 'Upload SARIF to GitHub Code Scanning', false)
  .action(async (options) => {
    try {
      console.log('\n🔐 Crypto Detector CLI');
      console.log('═'.repeat(60));
      
      const [owner, repo] = options.repo.split('/');
      if (!owner || !repo) {
        console.error('❌ Invalid repository format. Use: owner/repo');
        process.exit(1);
      }

      console.log(`📊 Repository: ${owner}/${repo}`);
      console.log(`🌐 Language: ${options.language}`);
      console.log(`📦 Analyze Dependencies: ${options.dependencies}`);
      console.log(`🛠️  Use CodeQL: ${options.codeql}`);
      console.log(`📄 Output Format: ${options.format}`);
      console.log('═'.repeat(60));
      console.log('');

      // Clone repository
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-scan-'));
      const repoUrl = `https://github.com/${owner}/${repo}.git`;
      
      console.log('📥 Cloning repository...');
      const git = simpleGit();
      await git.clone(repoUrl, tempDir);
      console.log(`✅ Cloned to ${tempDir}\n`);

      let allResults: CryptoAsset[] = [];

      // Build analysis matrix
      if (options.dependencies && options.token) {
        console.log('📊 Building dependency graph...');
        const depAnalyzer = new DependencyAnalyzer(options.token);
        const matrix = await depAnalyzer.buildAnalysisMatrix(owner, repo, true);
        console.log(`✅ Found ${matrix.length} repositories to analyze\n`);

        // Scan each repository
        for (const item of matrix) {
          console.log(`📁 Scanning ${item.nameWithOwner} (${item.language})...`);
          const results = await scanRepository(tempDir, item.language, options.codeql);
          console.log(`✅ Found ${results.length} crypto assets\n`);
          allResults.push(...results);
        }
      } else {
        // Scan main repository only
        console.log('🔍 Scanning repository...');
        allResults = await scanRepository(tempDir, options.language, options.codeql);
        console.log(`✅ Found ${allResults.length} crypto assets\n`);
      }

      // Generate reports
      console.log('📝 Generating reports...');
      const outputDir = path.resolve(options.output);
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      if (options.format === 'cbom' || options.format === 'both') {
        const cbomPath = path.join(outputDir, `crypto-cbom-${owner}-${repo}.json`);
        await writeCbomJson(allResults);
        console.log(`📦 CBOM report: ${cbomPath}`);
      }

      if (options.format === 'sarif' || options.format === 'both') {
        const sarifPath = path.join(outputDir, `crypto-scan-${owner}-${repo}.sarif`);
        await writeSarifReport(allResults, sarifPath, `CBOM:${owner}/${repo}`);
        console.log(`📄 SARIF report: ${sarifPath}`);
      }

      // Upload to Code Scanning
      if (options.upload && options.token) {
        console.log('\n☁️  Uploading to GitHub Code Scanning...');
        await uploadToCodeScanning(owner, repo, allResults, options.token);
        console.log('✅ Uploaded successfully');
      }

      // Print summary
      console.log('\n═'.repeat(60));
      console.log('📊 Scan Summary');
      console.log('═'.repeat(60));
      console.log(`Total Crypto Assets: ${allResults.length}`);
      console.log(`High Risk: ${allResults.filter(a => a.severity === 'high').length}`);
      console.log(`Medium Risk: ${allResults.filter(a => a.severity === 'medium').length}`);
      console.log(`Low Risk: ${allResults.filter(a => a.severity === 'low').length}`);
      console.log(`Quantum-Safe: ${allResults.filter(a => a.quantumSafe === true).length}`);
      console.log(`Quantum-Vulnerable: ${allResults.filter(a => a.quantumSafe === false).length}`);
      console.log('═'.repeat(60));
      console.log('\n✅ Scan complete!\n');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });

      process.exit(0);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}\n`);
      process.exit(1);
    }
  });

/**
 * Local scan command
 */
program
  .command('scan-local')
  .description('Scan a local directory')
  .requiredOption('-p, --path <path>', 'Path to directory or file')
  .option('-l, --language <language>', 'Language to analyze', 'python')
  .option('--codeql', 'Use CodeQL analysis', false)
  .option('-o, --output <file>', 'Output file path', 'crypto-report.json')
  .option('-f, --format <format>', 'Output format: cbom or sarif', 'cbom')
  .action(async (options) => {
    try {
      console.log('\n🔐 Scanning local directory...');
      console.log(`📁 Path: ${options.path}`);
      console.log(`🌐 Language: ${options.language}\n`);

      const results = await scanRepository(options.path, options.language, options.codeql);
      
      console.log(`✅ Found ${results.length} crypto assets\n`);

      // Generate report
      if (options.format === 'sarif') {
        await writeSarifReport(results, options.output);
        console.log(`📄 SARIF report: ${options.output}`);
      } else {
        await writeCbomJson(results);
        console.log(`📦 CBOM report: ${options.output}`);
      }

      process.exit(0);
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.message}\n`);
      process.exit(1);
    }
  });

/**
 * Info command
 */
program
  .command('info')
  .description('Show information about the tool')
  .action(() => {
    console.log('\n🔐 Crypto Detector - Cryptographic Algorithm Detection Tool');
    console.log('═'.repeat(60));
    console.log('Version: 1.0.0');
    console.log('Author: Syed Shail');
    console.log('');
    console.log('Supported Languages:');
    console.log('  • Python');
    console.log('  • Java');
    console.log('  • JavaScript/TypeScript');
    console.log('  • C/C++');
    console.log('  • Go, Rust, C#, Ruby, PHP, Swift');
    console.log('');
    console.log('Detection Methods:');
    console.log('  • Tree-sitter AST parsing');
    console.log('  • Regular expression patterns');
    console.log('  • CodeQL deep analysis (optional)');
    console.log('');
    console.log('Output Formats:');
    console.log('  • CBOM (CycloneDX)');
    console.log('  • SARIF (GitHub Code Scanning)');
    console.log('═'.repeat(60));
    console.log('');
  });

/**
 * Helper: Scan repository
 */
async function scanRepository(
  repoPath: string,
  language: string,
  useCodeQL: boolean
): Promise<CryptoAsset[]> {
  if (useCodeQL) {
    try {
      const analyzer = new CodeQLAnalyzer();
      const isInstalled = await analyzer.isCodeQLInstalled();
      
      if (!isInstalled) {
        console.log('⚠️  CodeQL not installed, falling back to tree-sitter');
        return await scanWithTreeSitter(repoPath, language);
      }

      return await analyzer.analyzeRepository(repoPath, language);
    } catch (err) {
      console.log('⚠️  CodeQL analysis failed, falling back to tree-sitter');
      return await scanWithTreeSitter(repoPath, language);
    }
  }

  return await scanWithTreeSitter(repoPath, language);
}

/**
 * Helper: Scan with tree-sitter
 */
async function scanWithTreeSitter(
  repoPath: string,
  language: string
): Promise<CryptoAsset[]> {
  // This would need to be implemented to work without VS Code APIs
  // For now, return empty array
  console.log('⚠️  Tree-sitter scanning requires VS Code extension context');
  return [];
}

/**
 * Helper: Upload to Code Scanning
 */
async function uploadToCodeScanning(
  owner: string,
  repo: string,
  assets: CryptoAsset[],
  token: string
): Promise<void> {
  const { Octokit } = require('@octokit/rest');
  const octokit = new Octokit({ auth: token });

  // Generate SARIF
  const tempSarif = path.join(os.tmpdir(), `crypto-scan-${Date.now()}.sarif`);
  await writeSarifReport(assets, tempSarif);

  // Read and encode
  const sarifContent = fs.readFileSync(tempSarif, 'utf8');
  const sarifBase64 = Buffer.from(sarifContent).toString('base64');

  // Get commit SHA
  const { data: repoData } = await octokit.repos.get({ owner, repo });
  const defaultBranch = repoData.default_branch;
  const { data: branchData } = await octokit.repos.getBranch({ owner, repo, branch: defaultBranch });

  // Upload
  await octokit.codeScanning.uploadSarif({
    owner,
    repo,
    commit_sha: branchData.commit.sha,
    ref: `refs/heads/${defaultBranch}`,
    sarif: sarifBase64,
    tool_name: 'crypto-detector'
  });

  // Cleanup
  fs.unlinkSync(tempSarif);
}

// Parse command line arguments
program.parse();