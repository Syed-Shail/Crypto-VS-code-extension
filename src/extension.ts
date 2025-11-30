// src/extension.ts

import * as vscode from 'vscode';
import { detectAll } from './parser/detector-orchestrator';
import { CryptoAsset } from './parser/types';
import { generateAndDownloadCbom } from './parser/report-writer';
import * as highlighter from './highlighter';
import { getIBMStyleDashboard } from './dashboard-ibm';
import { scanGithubRepo } from './commands/scanGithubRepo';
import { importCbom } from './commands/importCbom';

// Re-export for scanGithubRepo
export { getIBMStyleDashboard };

/**
 * Formats the detected crypto assets for display in VS Code output.
 */
function formatResults(results: CryptoAsset[]): string {
  if (results.length === 0) return '✅ No cryptographic algorithms detected.\n';

  let output = '🔍 Detected Cryptographic Algorithms:\n\n';
  output += '------------------------------------------------------------\n';

  for (const a of results) {
    const name = a.name ?? 'Unknown Algorithm';
    const primitive = a.primitive ?? 'unknown';
    const quantumSafe = a.quantumSafe ?? 'unknown';
    const severity = a.severity ?? 'unknown';
    const risk = a.riskScore ?? 0;

    let color = '🟩';
    if (severity === 'medium') color = '🟧';
    else if (severity === 'high') color = '🟥';
    else if (severity === 'none') color = '🟦';
    else if (severity === 'unknown') color = '⚪';

    output += `${color} ${name} (${primitive}) — Severity: ${severity.toUpperCase()} (Risk Score: ${risk})\n`;
    output += `  Quantum-Safe: ${quantumSafe}\n`;
    output += `  Occurrences: ${a.occurrences}\n`;

    for (const ctx of a.detectionContexts ?? []) {
      const lines = ctx.lineNumbers?.join(', ') ?? 'unknown';
      const snippet = ctx.snippet ?? '';
      const file = ctx.filePath ?? '(unknown file)';

      output += `  File: ${file}\n`;
      output += `  Lines: ${lines}\n`;
      if (snippet) output += `  Snippet: ${snippet.substring(0, 100)}...\n`;
    }

    output += '------------------------------------------------------------\n';
  }

  return output;
}

/**
 * Activates the extension and registers commands.
 */
export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Crypto Detector');

  /* --------------------------------------------------------------------------
   * 🧠 Register Commands
   * -------------------------------------------------------------------------- */

  // 🔹 GitHub repo scanner
  const scanGithubCmd = vscode.commands.registerCommand('crypto-detector.scanGithubRepo', scanGithubRepo);
  context.subscriptions.push(scanGithubCmd);

  // 🔹 CBOM importer
  const importCbomCmd = vscode.commands.registerCommand('crypto-detector.importCbom', importCbom);
  context.subscriptions.push(importCbomCmd);

  // 🔹 Export CBOM command
  const exportCbomCmd = vscode.commands.registerCommand('crypto-detector.exportCbom', async () => {
    vscode.window.showInformationMessage(
      'Please scan a file or workspace first, then use the dashboard to export CBOM.',
      'Scan Current File',
      'Scan Workspace'
    ).then(choice => {
      if (choice === 'Scan Current File') {
        vscode.commands.executeCommand('crypto-detector.detectCrypto');
      } else if (choice === 'Scan Workspace') {
        vscode.commands.executeCommand('crypto-detector.scanWorkspace');
      }
    });
  });
  context.subscriptions.push(exportCbomCmd);

  // 🔹 Inline highlighter & hover provider
  context.subscriptions.push(highlighter.registerHighlighter(context));

  /**
   * 🔍 Command: Scan current file
   */
  const scanFileCmd = vscode.commands.registerCommand('crypto-detector.detectCrypto', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active file open.');
      return;
    }

    const uri = editor.document.uri;

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Scanning ${uri.fsPath.split('/').pop()} for cryptographic algorithms...`,
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: 'Analyzing file...' });

        try {
          // ✅ Use unified detector (AST + Regex)
          const results = await detectAll(uri);

          // Highlight results
          await highlighter.applyHighlights(results);

          // Format and display
          const formatted = formatResults(results);
          output.appendLine(formatted);
          output.show(true);

          // Prompt for CBOM generation
          if (results.length > 0) {
            const choice = await vscode.window.showInformationMessage(
              `🔐 Detected ${results.length} cryptographic algorithm(s) in file. Generate CBOM file?`,
              'Yes',
              'No'
            );
            if (choice === 'Yes') {
              await generateAndDownloadCbom(results);
            }
          } else {
            vscode.window.showInformationMessage('✅ No cryptographic algorithms found.');
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error scanning file: ${err.message}`);
          console.error('[detectCrypto]', err);
        }
      }
    );
  });

  /**
   * 🌍 Command: Scan entire workspace
   */
  const scanWorkspaceCmd = vscode.commands.registerCommand('crypto-detector.scanWorkspace', async () => {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showWarningMessage('No workspace folder is open.');
      return;
    }

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Scanning entire workspace for cryptographic algorithms...',
        cancellable: true
      },
      async (progress, token) => {
        let processed = 0;

        const files = await vscode.workspace.findFiles('**/*.{py,java,c,cpp,go,rs,txt,cfg,conf,yml,yaml,json,js,ts}', '**/node_modules/**');
        const total = files.length;

        for (const file of files) {
          if (token.isCancellationRequested) break;
          progress.report({ message: `Analyzing ${++processed}/${total}: ${file.fsPath.split('/').pop()}` });
        }

        try {
          const allResults: CryptoAsset[] = [];

          // Scan all files with unified detector
          for (const file of files) {
            if (token.isCancellationRequested) break;
            try {
              const results = await detectAll(file);
              allResults.push(...results);
            } catch (err) {
              console.warn('[scanWorkspace] Error scanning file:', file.fsPath, err);
            }
          }

          await highlighter.applyHighlights(allResults);

          const formatted = formatResults(allResults);
          output.appendLine(formatted);
          output.show(true);

          if (allResults.length === 0) {
            vscode.window.showInformationMessage('✅ No cryptographic algorithms found in workspace.');
            return;
          }

          // 🧠 Display interactive dashboard
          const panel = vscode.window.createWebviewPanel(
            'cryptoDashboard',
            'IBM Cryptographic Bill of Materials',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
          );
          panel.webview.html = getIBMStyleDashboard(allResults);

          // Listen for button clicks inside the WebView
          panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'generateCbom') {
              await generateAndDownloadCbom(allResults);
            }
          });
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error scanning workspace: ${err.message}`);
          console.error('[scanWorkspace]', err);
        }
      }
    );
  });

  /**
   * 📊 Command: Manually open dashboard
   */
  const showDashboardCmd = vscode.commands.registerCommand('crypto-detector.showDashboard', async () => {
    const panel = vscode.window.createWebviewPanel(
      'cryptoDashboard',
      'IBM Cryptographic Bill of Materials',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = getIBMStyleDashboard([]);
  });

  // Register all commands and output
  context.subscriptions.push(scanFileCmd, scanWorkspaceCmd, showDashboardCmd, output);

  console.log('✅ Crypto Detector extension activated!');
}

/**
 * 🧹 Deactivate cleanup.
 */
export function deactivate() {
  // no cleanup needed yet
}