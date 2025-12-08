// src/extension.ts - Updated to show dashboard after all scans

import * as vscode from 'vscode';
import * as parser from './parser/index';
import { CryptoAsset } from './parser/types';
import { generateAndDownloadCbom } from './parser/report-writer';
import * as highlighter from './highlighter';
import { getDashboardHtml } from './dashboard';
import { getIBMStyleDashboard } from './dashboard-ibm';
import { scanGithubRepo } from './commands/scanGithubRepo';
import { viewCbom } from './commands/viewCbom';
import { runLocalWorkflow } from './commands/runLocalWorkflow';

/**
 * Show dashboard with detected assets
 */
async function showDashboard(assets: CryptoAsset[], title: string = 'Crypto Risk Dashboard'): Promise<void> {
  if (assets.length === 0) {
    vscode.window.showInformationMessage('✅ No cryptographic algorithms detected.');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'cryptoDashboard',
    title,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  // Use IBM-style dashboard for better visuals
  panel.webview.html = getIBMStyleDashboard(assets);

  // Listen for CBOM generation requests from dashboard
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.command === 'generateCbom') {
      await generateAndDownloadCbom(assets);
    }
  });
}

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
            // Show dashboard automatically
            await showDashboard(results, `Crypto Analysis - ${uri.fsPath.split('/').pop()}`);
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

          // Show dashboard automatically
          await showDashboard(results, 'Workspace Crypto Analysis');

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
   * Command: Scan GitHub Repository (Enhanced with Dashboard)
   */
  const scanGithubCmd = vscode.commands.registerCommand('crypto-detector.scanGithubRepo', async () => {
    console.log('🐙 Running crypto-detector.scanGithubRepo command');
    await scanGithubRepo();
    // Note: scanGithubRepo now shows dashboard internally
  });

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
    
    // Show empty dashboard with instructions
    const panel = vscode.window.createWebviewPanel(
      'cryptoDashboard',
      'Crypto Risk Dashboard',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: system-ui, sans-serif;
            background: #0d1117;
            color: #e6edf3;
            padding: 40px;
            text-align: center;
          }
          h1 { color: #58a6ff; margin-bottom: 20px; }
          p { font-size: 16px; line-height: 1.6; margin: 20px auto; max-width: 600px; }
          .commands {
            background: #161b22;
            border-radius: 8px;
            padding: 20px;
            margin: 30px auto;
            max-width: 500px;
            text-align: left;
          }
          code {
            background: #21262d;
            padding: 2px 6px;
            border-radius: 4px;
            color: #79c0ff;
          }
        </style>
      </head>
      <body>
        <h1>🔐 Crypto Detector Dashboard</h1>
        <p>No scan results available yet. Run a scan to see the analysis dashboard.</p>
        <div class="commands">
          <h3 style="color: #58a6ff; margin-top: 0;">Available Commands:</h3>
          <ul style="line-height: 2;">
            <li><code>Crypto Detector: Scan Current File</code></li>
            <li><code>Crypto Detector: Scan Entire Workspace</code></li>
            <li><code>Crypto Detector: Scan GitHub Repository</code></li>
          </ul>
        </div>
      </body>
      </html>
    `;
  });

  /**
   * Command: Run Local Workflow (builds matrix, scans everything)
   */
  const runLocalWorkflowCmd = vscode.commands.registerCommand('crypto-detector.runLocalWorkflow', async () => {
    console.log('⚙️ Running crypto-detector.runLocalWorkflow command');
    await runLocalWorkflow();
    // Note: runLocalWorkflow shows its own specialized dashboard
  });

  const testCbomCmd = vscode.commands.registerCommand('crypto-detector.testCBOM', async () => {
    console.log('🧪 Running test CBOM generation');
    const { testCBOMGeneration } = await import('./commands/runLocalWorkflow');
    await testCBOMGeneration();
  });

  context.subscriptions.push(testCbomCmd);

  // Register all commands
  context.subscriptions.push(
    scanFileCmd, 
    scanWorkspaceCmd, 
    exportCbomCmd,
    scanGithubCmd,
    viewCbomCmd,
    showDashboardCmd,
    runLocalWorkflowCmd,
    output
  );

  console.log('✅ All commands registered successfully:');
  console.log('  - crypto-detector.detectCrypto');
  console.log('  - crypto-detector.scanWorkspace');
  console.log('  - crypto-detector.exportCbom');
  console.log('  - crypto-detector.scanGithubRepo');
  console.log('  - crypto-detector.viewCbom');
  console.log('  - crypto-detector.showDashboard');
  console.log('  - crypto-detector.runLocalWorkflow');
}

export function deactivate() {
  console.log('👋 Crypto Detector extension deactivated');
}