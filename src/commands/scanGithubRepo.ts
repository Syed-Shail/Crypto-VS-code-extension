// src/commands/scanGithubRepo.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import simpleGit from 'simple-git';
import * as parser from '../parser';
import * as highlighter from '../highlighter';
import { getDashboardHtml } from '../dashboard';
import { generateAndDownloadCbom } from '../parser/report-writer';
import { CryptoAsset } from '../parser/types';

export async function scanGithubRepo() {
  const repoUrlInput = await vscode.window.showInputBox({
    prompt: 'Enter GitHub repository URL to scan',
    placeHolder: 'https://github.com/username/repository',
  });

  if (!repoUrlInput) {
    vscode.window.showWarningMessage('No repository URL provided.');
    return;
  }

  // normalize
  let repoUrl = repoUrlInput.trim()
    .replace(/\/blob\/.*/, '')
    .replace(/\.git.*/, '')
    .replace(/\/$/, '');
  if (!repoUrl.startsWith('https://')) repoUrl = 'https://' + repoUrl;
  if (!repoUrl.endsWith('.git')) repoUrl += '.git';

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbom-scan-'));
  const git = simpleGit();

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Cloning ${repoUrl}...`,
      cancellable: true,
    },
    async (progress, token) => {
      try {
        progress.report({ message: 'Cloning repository...' });
        await git.clone(repoUrl, tempDir);

        progress.report({ message: 'Enumerating files...' });

        // helper: recursive walk (sync for simplicity)
        function walkDir(dir: string, exts: string[], ignoreDirs = new Set(['.git', 'node_modules', 'dist', 'out', 'build'])): string[] {
          let results: string[] = [];
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (token.isCancellationRequested) break;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
              if (ignoreDirs.has(e.name)) continue;
              results.push(...walkDir(full, exts, ignoreDirs));
            } else if (e.isFile()) {
              const ext = path.extname(full).toLowerCase();
              if (exts.includes(ext)) results.push(full);
            }
          }
          return results;
        }

        const exts = ['.py', '.java', '.c', '.cpp', '.go', '.rs', '.txt', '.cfg', '.conf', '.yml', '.yaml', '.json', '.js', '.ts'];
        const files = walkDir(tempDir, exts);

        progress.report({ message: `Scanning ${files.length} files...` });

        const results: CryptoAsset[] = [];
        let processed = 0;

        for (const f of files) {
          if (token.isCancellationRequested) break;
          processed++;
          progress.report({ message: `Analyzing ${processed}/${files.length}: ${path.basename(f)}` });

          try {
            const uri = vscode.Uri.file(f);
            const hits = await parser.detectInDocument(uri);
            if (hits && hits.length) results.push(...hits);
          } catch (err: any) {
            console.warn(`[scanGithubRepo] Failed to analyze ${f}:`, err);
          }
        }

        // Apply highlights (will only affect open editors)
        await highlighter.applyHighlights(results);

        vscode.window.showInformationMessage(
          `✅ Scan complete. Found ${results.length} cryptographic algorithm(s).`
        );

        const panel = vscode.window.createWebviewPanel(
          'cryptoDashboard',
          'Crypto Risk Dashboard — GitHub Scan',
          vscode.ViewColumn.One,
          { enableScripts: true, retainContextWhenHidden: true }
        );
        panel.webview.html = getDashboardHtml(results);

        panel.webview.onDidReceiveMessage(async (message) => {
          if (message.command === 'generateCbom') {
            await generateAndDownloadCbom(results);
          }
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ Error scanning GitHub repo: ${err.message}`);
      } finally {
        // cleanup optional: keep temp for debugging; remove if desired
        // fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  );
}
