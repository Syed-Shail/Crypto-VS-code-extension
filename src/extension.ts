// src/extension.ts

import * as vscode from 'vscode';
import * as parser from './parser/index';
import { CryptoAsset } from './parser/types';
import { generateAndDownloadCbom } from './parser/report-writer';
import * as highlighter from './highlighter';
import { getDashboardHtml } from './dashboard';

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
      if (snippet) output += `  Snippet: ${snippet}\n`;
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

  // ✅ Register the inline highlighter and hover provider
  context.subscriptions.push(highlighter.registerHighlighter(context));

  /**
   * Command: Scan current file
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
          const results = await parser.detectInDocument(uri);
          await highlighter.applyHighlights(results);

          const formatted = formatResults(results);
          output.appendLine(formatted);
          output.show(true);

          if (results.length > 0) {
            await vscode.window.showInformationMessage(
              `🔐 Detected ${results.length} cryptographic algorithm(s) in file. Generate CBOM file?`,
              "Yes",
              "No"
            ).then(async (choice) => {
              if (choice === "Yes") {
                await generateAndDownloadCbom(results);
              }
            });
          } else {
            vscode.window.showInformationMessage(`✅ No cryptographic algorithms found.`);
          }
        } catch (err: any) {
          vscode.window.showErrorMessage(`Error scanning file: ${err.message}`);
        }
      }
    );
  });

  /**
   * Command: Scan entire workspace
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
        const onProgress = (p: { processed: number; total?: number }): void => {
          const total = p.total ?? 'unknown';
          progress.report({ message: `Processed ${p.processed}/${total}` });
        };

        try {
          const results = await parser.scanWorkspace(onProgress, token);
          await highlighter.applyHighlights(results);

          const formatted = formatResults(results);
          output.appendLine(formatted);
          output.show(true);
          
          if (results.length === 0) {
            vscode.window.showInformationMessage('✅ No cryptographic algorithms found in workspace.');
            return;
          }

          // Show Dashboard View automatically after scan
          const panel = vscode.window.createWebviewPanel(
            'cryptoDashboard',
            'Crypto Risk Dashboard',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
          );
          panel.webview.html = getDashboardHtml(results);

          // Listen for button clicks from inside the WebView
          panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'generateCbom') {
              await generateAndDownloadCbom(results);
            }
          });

        } catch (err: any) {
          vscode.window.showErrorMessage(`Error scanning workspace: ${err.message}`);
        }
      }
    );
  });

  /**
   * Command: Manually show dashboard
   */
  const showDashboardCmd = vscode.commands.registerCommand('crypto-detector.showDashboard', async () => {
    const panel = vscode.window.createWebviewPanel(
      'cryptoDashboard',
      'Crypto Risk Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = getDashboardHtml([]);
  });

  context.subscriptions.push(scanFileCmd, scanWorkspaceCmd, showDashboardCmd, output);
}

export function deactivate() {
  // Cleanup if needed
}