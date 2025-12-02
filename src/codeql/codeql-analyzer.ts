// src/codeql/codeql-analyzer.ts
import * as vscode from 'vscode';
import { exec, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import { CryptoAsset, Severity } from '../parser/types';
import { assignRisk } from '../parser/risk-utils';

interface SarifResult {
  ruleId: string;
  level: string;
  message: {
    text: string;
  };
  locations: Array<{
    physicalLocation: {
      artifactLocation: {
        uri: string;
      };
      region: {
        startLine: number;
        endLine?: number;
        snippet?: {
          text: string;
        };
      };
    };
  }>;
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      rules?: Array<{
        id: string;
        shortDescription?: { text: string };
        properties?: any;
      }>;
    };
  };
  results: SarifResult[];
}

interface SarifFile {
  version: string;
  runs: SarifRun[];
}

export class CodeQLAnalyzer {
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('CodeQL Analyzer');
  }

  /**
   * Check if CodeQL is installed
   */
  async isCodeQLInstalled(): Promise<boolean> {
    try {
      execSync('codeql --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install CodeQL CLI (for GitHub Codespaces or CI environments)
   */
  async installCodeQL(): Promise<void> {
    this.outputChannel.appendLine('Installing CodeQL CLI...');
    
    const installScript = `
      curl -L https://github.com/github/codeql-cli-binaries/releases/latest/download/codeql-linux64.zip -o codeql.zip
      unzip -q codeql.zip
      export PATH="$PATH:$(pwd)/codeql"
    `;
    
    await this.execAsync(installScript);
    this.outputChannel.appendLine('✅ CodeQL CLI installed');
  }

  /**
   * Create CodeQL database for a repository
   */
  async createDatabase(
    repoPath: string,
    language: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<string> {
    const dbName = 'codeql-db';
    const dbPath = path.join(repoPath, '.codeql', dbName);

    // Check if database already exists
    try {
      await fs.access(dbPath);
      this.outputChannel.appendLine(`✅ Using existing database at ${dbPath}`);
      return dbPath;
    } catch {
      // Database doesn't exist, create it
    }

    progress.report({ message: 'Creating CodeQL database...' });
    this.outputChannel.appendLine(`Creating CodeQL database for ${language}...`);

    try {
      // Create database directory
      await fs.mkdir(path.dirname(dbPath), { recursive: true });

      // Map language names to CodeQL language identifiers
      const langMap: Record<string, string> = {
        'javascript': 'javascript',
        'typescript': 'javascript',
        'python': 'python',
        'java': 'java',
        'cpp': 'cpp',
        'c': 'cpp',
        'csharp': 'csharp',
        'go': 'go',
        'ruby': 'ruby'
      };

      const codeqlLang = langMap[language.toLowerCase()] || language;

      // Create database
      const createCmd = `codeql database create "${dbPath}" \\
        --language=${codeqlLang} \\
        --source-root="${repoPath}" \\
        --overwrite`;

      await this.execAsync(createCmd, { cwd: repoPath });
      
      this.outputChannel.appendLine(`✅ Database created at ${dbPath}`);
      return dbPath;
    } catch (err: any) {
      this.outputChannel.appendLine(`❌ Failed to create database: ${err.message}`);
      throw new Error(`CodeQL database creation failed: ${err.message}`);
    }
  }

  /**
   * Download CodeQL database from GitHub (if available)
   */
  async downloadDatabase(
    owner: string,
    repo: string,
    language: string,
    token?: string
  ): Promise<string | null> {
    try {
      const outputPath = path.join(process.cwd(), '.codeql', `${repo}-db.zip`);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      const headers = token ? `-H "Authorization: Bearer ${token}"` : '';
      
      const downloadCmd = `curl -L ${headers} \\
        -H "Accept: application/zip" \\
        -H "X-GitHub-Api-Version: 2022-11-28" \\
        "https://api.github.com/repos/${owner}/${repo}/code-scanning/codeql/databases/${language}" \\
        -o "${outputPath}"`;

      await this.execAsync(downloadCmd);

      // Unbundle database
      const dbPath = path.join(path.dirname(outputPath), `${repo}-db`);
      await this.execAsync(`codeql database unbundle "${outputPath}" --target="${dbPath}"`);

      this.outputChannel.appendLine(`✅ Downloaded database from GitHub`);
      return dbPath;
    } catch (err) {
      this.outputChannel.appendLine(`⚠️  Could not download database from GitHub`);
      return null;
    }
  }

  /**
   * Run CodeQL analysis on a database
   */
  async analyzeDatabase(
    dbPath: string,
    language: string,
    outputPath: string,
    progress: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<string> {
    progress.report({ message: 'Running CodeQL cryptography queries...' });
    this.outputChannel.appendLine('Running CodeQL analysis...');

    try {
      // Ensure output directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Run CodeQL analysis with crypto queries
      const queryPath = `codeql/${language}-queries:experimental/cryptography/inventory/new_models`;
      
      const analyzeCmd = `codeql database analyze "${dbPath}" \\
        "${queryPath}" \\
        --format=sarifv2.1.0 \\
        --output="${outputPath}" \\
        --sarif-category="CBOM:crypto-detector" \\
        --sarif-add-query-help \\
        --sarif-add-snippets \\
        --timeout=300`;

      await this.execAsync(analyzeCmd);

      this.outputChannel.appendLine(`✅ Analysis complete: ${outputPath}`);
      return outputPath;
    } catch (err: any) {
      this.outputChannel.appendLine(`❌ Analysis failed: ${err.message}`);
      throw new Error(`CodeQL analysis failed: ${err.message}`);
    }
  }

  /**
   * Parse SARIF file and convert to CryptoAsset format
   */
  async parseSarifResults(sarifPath: string): Promise<CryptoAsset[]> {
    try {
      const content = await fs.readFile(sarifPath, 'utf8');
      const sarif: SarifFile = JSON.parse(content);

      const assets: CryptoAsset[] = [];
      const seenIds = new Set<string>();

      for (const run of sarif.runs) {
        const rules = new Map(
          run.tool.driver.rules?.map(r => [r.id, r]) || []
        );

        for (const result of run.results) {
          const rule = rules.get(result.ruleId);
          const algorithmName = this.extractAlgorithmName(result, rule);

          for (const location of result.locations) {
            const filePath = location.physicalLocation.artifactLocation.uri;
            const lineNumber = location.physicalLocation.region.startLine;
            const snippet = location.physicalLocation.region.snippet?.text || '';

            const id = `codeql:${algorithmName.toLowerCase()}-${filePath}-${lineNumber}`;
            
            if (seenIds.has(id)) {
              continue;
            }
            seenIds.add(id);

            const algorithmInfo = this.classifyAlgorithm(algorithmName);
            const risk = assignRisk(
              algorithmInfo.quantumSafe,
              algorithmInfo.type,
              algorithmName
            );

            assets.push({
              name: algorithmName,
              type: algorithmInfo.type,
              primitive: algorithmInfo.type,
              assetType: 'algorithm',
              description: result.message.text,
              quantumSafe: algorithmInfo.quantumSafe,
              severity: risk.severity as Severity,
              score: risk.score,
              riskScore: risk.score,
              reason: risk.explanation,
              source: filePath,
              line: lineNumber,
              occurrences: 1,
              id,
              detectionContexts: [
                {
                  filePath,
                  lineNumbers: [lineNumber],
                  snippet: snippet.substring(0, 200)
                }
              ]
            });
          }
        }
      }

      this.outputChannel.appendLine(`✅ Parsed ${assets.length} crypto assets from SARIF`);
      return assets;
    } catch (err: any) {
      this.outputChannel.appendLine(`❌ Failed to parse SARIF: ${err.message}`);
      throw new Error(`SARIF parsing failed: ${err.message}`);
    }
  }

  /**
   * Extract algorithm name from SARIF result
   */
  private extractAlgorithmName(result: SarifResult, rule: any): string {
    // Try to get algorithm name from rule properties
    if (rule?.properties?.algorithmName) {
      return rule.properties.algorithmName;
    }

    // Extract from message
    const message = result.message.text;
    const algorithmMatch = message.match(/(?:algorithm|cipher|hash):\s*([A-Z0-9-]+)/i);
    if (algorithmMatch) {
      return algorithmMatch[1];
    }

    // Extract from rule ID
    const ruleIdMatch = result.ruleId.match(/crypto[/-]([a-z0-9-]+)/i);
    if (ruleIdMatch) {
      return ruleIdMatch[1].toUpperCase();
    }

    return 'Unknown';
  }

  /**
   * Classify algorithm and determine quantum safety
   */
  private classifyAlgorithm(name: string): {
    type: string;
    quantumSafe: boolean | 'partial' | 'unknown';
  } {
    const nameLower = name.toLowerCase();

    // Post-quantum algorithms
    if (/kyber|dilithium|falcon|sphincs|ntru|mceliece/i.test(name)) {
      return { type: 'pqc', quantumSafe: true };
    }

    // Broken/weak algorithms
    if (/md5|sha-?1|des(?!-ede3)|rc4|rc2/i.test(name)) {
      return { type: 'hash', quantumSafe: false };
    }

    // Asymmetric (quantum-vulnerable)
    if (/rsa|dsa|ecdsa|ecdh|ec|ed25519|x25519/i.test(name)) {
      return { type: 'asymmetric', quantumSafe: false };
    }

    // Symmetric (partial quantum resistance)
    if (/aes|chacha|salsa|blowfish/i.test(name)) {
      return { type: 'symmetric', quantumSafe: 'partial' };
    }

    // Hash functions (partial quantum resistance)
    if (/sha-?2|sha-?3|blake|keccak/i.test(name)) {
      return { type: 'hash', quantumSafe: 'partial' };
    }

    return { type: 'unknown', quantumSafe: 'unknown' };
  }

  /**
   * Execute command asynchronously
   */
  private execAsync(
    command: string,
    options?: { cwd?: string }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, options, (error, stdout, stderr) => {
        if (error) {
          this.outputChannel.appendLine(`Error: ${stderr}`);
          reject(error);
        } else {
          this.outputChannel.appendLine(stdout);
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Full analysis pipeline
   */
  async analyzeRepository(
    repoPath: string,
    language: string,
    owner?: string,
    repo?: string,
    token?: string
  ): Promise<CryptoAsset[]> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'CodeQL Analysis',
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: 'Checking CodeQL installation...' });

        // Check if CodeQL is installed
        const isInstalled = await this.isCodeQLInstalled();
        if (!isInstalled) {
          throw new Error(
            'CodeQL CLI is not installed. Please install it from: https://github.com/github/codeql-cli-binaries'
          );
        }

        let dbPath: string | null = null;

        // Try to download database from GitHub first
        if (owner && repo) {
          progress.report({ message: 'Attempting to download CodeQL database from GitHub...' });
          dbPath = await this.downloadDatabase(owner, repo, language, token);
        }

        // Create database if download failed
        if (!dbPath) {
          dbPath = await this.createDatabase(repoPath, language, progress);
        }

        // Run analysis
        const sarifPath = path.join(repoPath, '.codeql', `${language}-results.sarif`);
        await this.analyzeDatabase(dbPath, language, sarifPath, progress);

        // Parse results
        progress.report({ message: 'Parsing results...' });
        const assets = await this.parseSarifResults(sarifPath);

        return assets;
      }
    );
  }
}