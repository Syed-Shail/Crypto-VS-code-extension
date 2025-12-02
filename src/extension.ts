// src/extension.ts - Updated with new advanced command

import * as vscode from 'vscode';
import * as parser from './parser/index';
import { CryptoAsset } from './parser/types';
import { generateAndDownloadCbom } from './parser/report-writer';
import * as highlighter from './highlighter';
import { getDashboardHtml } from './dashboard';
import { scanGithubRepo } from './commands/scanGithubRepo';
import { scanGithubRepoAdvanced } from './commands/scanGithubAdvanced';
import { viewCbom } from './commands/viewCbom';

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
  console.log('🔐 Crypto Detector extension is now active!');
  
  const output = vscode.window.createOutputChannel('Crypto Detector');

  // ✅ Register the inline highlighter and hover provider
  try {
    context.subscriptions.push(highlighter.registerHighlighter(context));
    console.log('✅ Highlighter registered');
  } catch (err) {
    console.error('❌ Failed to register highlighter:', err);
  }

  /**
   * Command: Scan current file
   */
  const scanFileCmd = vscode.commands.registerCommand('crypto-detector.detectCrypto', async () => {
    console.log('🔍 Running crypto-detector.detectCrypto command');
    
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
          console.error('❌ Error scanning file:', err);
          vscode.window.showErrorMessage(`Error scanning file: ${err.message}`);
        }
      }
    );
  });

  /**
   * Command: Scan entire workspace
   */
  const scanWorkspaceCmd = vscode.commands.registerCommand('crypto-detector.scanWorkspace', async () => {
    console.log('🔍 Running crypto-detector.scanWorkspace command');
    
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
          console.error('❌ Error scanning workspace:', err);
          vscode.window.showErrorMessage(`Error scanning workspace: ${err.message}`);
        }
      }
    );
  });

  /**
   * Command: Export CBOM
   */
  const exportCbomCmd = vscode.commands.registerCommand('crypto-detector.exportCbom', async () => {
    console.log('📦 Running crypto-detector.exportCbom command');
    vscode.window.showInformationMessage('Please run a scan first to generate CBOM data.');
  });

  /**
   * Command: Scan GitHub Repository (Basic)
   */
  const scanGithubCmd = vscode.commands.registerCommand('crypto-detector.scanGithubRepo', async () => {
    console.log('🐙 Running crypto-detector.scanGithubRepo command');
    await scanGithubRepo();
  });

  /**
   * NEW Command: Scan GitHub Repository (Advanced)
   */
  const scanGithubAdvancedCmd = vscode.commands.registerCommand(
    'crypto-detector.scanGithubRepoAdvanced',
    async () => {
      console.log('🚀 Running crypto-detector.scanGithubRepoAdvanced command');
      await scanGithubRepoAdvanced();
    }
  );

  /**
   * Command: View/Visualize CBOM File
   */
  const viewCbomCmd = vscode.commands.registerCommand('crypto-detector.viewCbom', async () => {
    console.log('📊 Running crypto-detector.viewCbom command');
    await viewCbom();
  });

  /**
   * Command: Manually show dashboard
   */
  const showDashboardCmd = vscode.commands.registerCommand('crypto-detector.showDashboard', async () => {
    console.log('📊 Running crypto-detector.showDashboard command');
    
    const panel = vscode.window.createWebviewPanel(
      'cryptoDashboard',
      'Crypto Risk Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = getDashboardHtml([]);
  });

  // Register all commands
  context.subscriptions.push(
    scanFileCmd, 
    scanWorkspaceCmd, 
    exportCbomCmd,
    scanGithubCmd,
    scanGithubAdvancedCmd,
    viewCbomCmd,
    showDashboardCmd, 
    output
  );

  console.log('✅ All commands registered successfully:');
  console.log('  - crypto-detector.detectCrypto');
  console.log('  - crypto-detector.scanWorkspace');
  console.log('  - crypto-detector.exportCbom');
  console.log('  - crypto-detector.scanGithubRepo');
  console.log('  - crypto-detector.scanGithubRepoAdvanced (NEW)');
  console.log('  - crypto-detector.viewCbom');
  console.log('  - crypto-detector.showDashboard');
}

export function deactivate() {
  console.log('👋 Crypto Detector extension deactivated');
}