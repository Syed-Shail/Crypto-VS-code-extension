import * as vscode from 'vscode';
import * as parser from './parser';

/* --------------------------------------------------------------------------
 * Activation Entry Point
 * -------------------------------------------------------------------------- */
export function activate(context: vscode.ExtensionContext) {
  console.log('🔐 Crypto Detector Extension Activated');

  const diagnosticCollection = vscode.languages.createDiagnosticCollection('crypto-detector');
  context.subscriptions.push(diagnosticCollection);

  /* ------------------------------------------------------------------------
   * 1️⃣ Command: Scan Current File
   * ------------------------------------------------------------------------ */
  const detectSingle = vscode.commands.registerCommand('crypto-detector.detectCrypto', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Open a file to analyze first!');
      return;
    }

    const uri = editor.document.uri;
    try {
      const assets = await parser.detectInDocument(uri);
      showResultsAndDiagnostics(assets, diagnosticCollection);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error scanning file: ${err.message || err}`);
    }
  });

  /* ------------------------------------------------------------------------
   * 2️⃣ Command: Scan Entire Workspace
   * ------------------------------------------------------------------------ */
  const scanWorkspaceCmd = vscode.commands.registerCommand('crypto-detector.scanWorkspace', async () => {
    const output = vscode.window.createOutputChannel('Crypto Detector');
    output.clear();
    output.show(true);
    output.appendLine('🔍 Starting workspace scan...');

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Crypto Detector — Scanning workspace',
          cancellable: true
        },
        async (progress, token) => {
          const onProgress = (p: { processed: number; total?: number }) => {
            const total = p.total ?? 'unknown';
            progress.report({ message: `Processed ${p.processed}/${total}` });
          };

          const assets = await parser.scanWorkspace(undefined, undefined, onProgress, token);

          output.appendLine(`\n✅ Scan complete. Found ${assets.length} algorithms.`);
          output.appendLine('──────────────────────────────────────────────');

          for (const a of assets) {
            output.appendLine(`🧩 ${a.name}`);
            output.appendLine(`   • Type: ${a.primitive}`);
            output.appendLine(`   • Key Size: ${a.keySize}`);
            output.appendLine(`   • Occurrences: ${a.occurrences}`);
            output.appendLine(`   • Quantum Safety: ${a.quantumSafe}`);
            output.appendLine(`   • Description: ${a.description}`);
            output.appendLine('──────────────────────────────────────────────');
          }

          if (assets.length === 0) {
            output.appendLine('✅ No known cryptographic algorithms found.');
          }

          // Write summary file
          try {
            const outPath = await parser.writeCbomJson(assets);
            output.appendLine(`📄 JSON summary written to: ${outPath}`);
            vscode.window.showInformationMessage(`Scan complete! Results saved to cbom.json`);
          } catch (err: any) {
            output.appendLine(`⚠️ Failed to write cbom.json: ${err.message || err}`);
          }

          // Display diagnostics in any open files
          showResultsAndDiagnostics(assets, diagnosticCollection);
        }
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Workspace scan failed: ${err.message || err}`);
    }
  });

  /* ------------------------------------------------------------------------
   * 3️⃣ Command: Export JSON Summary
   * ------------------------------------------------------------------------ */
  const exportCbomCmd = vscode.commands.registerCommand('crypto-detector.exportCbom', async () => {
    const output = vscode.window.createOutputChannel('Crypto Detector');
    output.show(true);
    output.appendLine('📦 Generating JSON summary...');
    try {
      const assets = await parser.scanWorkspace();
      const outPath = await parser.writeCbomJson(assets);
      output.appendLine(`✅ cbom.json exported successfully: ${outPath}`);
      vscode.window.showInformationMessage(`cbom.json exported to workspace root.`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Export failed: ${err.message || err}`);
    }
  });

  context.subscriptions.push(detectSingle, scanWorkspaceCmd, exportCbomCmd);
}

/* --------------------------------------------------------------------------
 * Diagnostics + Output Channel Reporting
 * -------------------------------------------------------------------------- */
function showResultsAndDiagnostics(assets: parser.CryptoAsset[], diagnosticCollection: vscode.DiagnosticCollection) {
  const output = vscode.window.createOutputChannel('Crypto Detector');
  output.clear();
  output.appendLine('🔍 CRYPTOGRAPHIC ANALYSIS REPORT');
  output.appendLine('──────────────────────────────────────────────');

  if (assets.length === 0) {
    output.appendLine('✅ No known cryptographic algorithms found.');
    diagnosticCollection.clear();
    output.show(true);
    return;
  }

  const diagnosticsByFile: Map<string, vscode.Diagnostic[]> = new Map();

  for (const asset of assets) {
    output.appendLine(`🧩 Algorithm: ${asset.name}`);
    output.appendLine(`   • Type: ${asset.primitive}`);
    output.appendLine(`   • Key Size: ${asset.keySize}`);
    output.appendLine(`   • Occurrences: ${asset.occurrences}`);
    output.appendLine(`   • Quantum Safety: ${asset.quantumSafe}`);
    output.appendLine(`   • Description: ${asset.description}`);
    output.appendLine('──────────────────────────────────────────────');

    for (const ctx of asset.detectionContexts) {
      const severity =
        asset.quantumSafe === false
          ? vscode.DiagnosticSeverity.Error
          : asset.quantumSafe === 'partial'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Hint;

      for (const line of ctx.lineNumbers) {
        const diag = new vscode.Diagnostic(
          new vscode.Range(new vscode.Position(line - 1, 0), new vscode.Position(line - 1, 100)),
          `${asset.name} detected — ${asset.quantumSafe}`,
          severity
        );
        diag.source = 'crypto-detector';

        if (!diagnosticsByFile.has(ctx.filePath)) diagnosticsByFile.set(ctx.filePath, []);
        diagnosticsByFile.get(ctx.filePath)!.push(diag);
      }
    }
  }

  diagnosticCollection.clear();
  for (const [file, diags] of diagnosticsByFile) {
    try {
      const fileUri = vscode.Uri.file(file);
      diagnosticCollection.set(fileUri, diags);
    } catch {
      // skip invalid file URIs
    }
  }

  output.show(true);
}

/* --------------------------------------------------------------------------
 * Cleanup
 * -------------------------------------------------------------------------- */
export function deactivate() {
  console.log('Crypto Detector Extension Deactivated');
}
