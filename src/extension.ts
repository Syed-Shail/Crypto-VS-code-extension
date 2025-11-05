import * as vscode from 'vscode';
import * as parser from './parser';

export function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('crypto-detector');
  context.subscriptions.push(diagnosticCollection);

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

  const scanWorkspaceCmd = vscode.commands.registerCommand('crypto-detector.scanWorkspace', async () => {
    const output = vscode.window.createOutputChannel('Crypto Detector');
    output.show(true);
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Scanning workspace', cancellable: true },
        async (progress, token) => {
          const onProgress = (p: { processed: number; total?: number }) => {
            progress.report({ message: `Processed ${p.processed}/${p.total ?? '?'}` });
          };
          const assets = await parser.scanWorkspace(undefined, undefined, onProgress, token);
          showResultsAndDiagnostics(assets, diagnosticCollection);
          const outPath = await parser.writeCbomJson(assets);
          output.appendLine(`Scan complete — results saved to ${outPath}`);
          vscode.window.showInformationMessage('Crypto scan complete — cbom.json generated!');
        }
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Workspace scan failed: ${err.message || err}`);
    }
  });

  context.subscriptions.push(detectSingle, scanWorkspaceCmd);
}

function showResultsAndDiagnostics(assets: parser.CryptoAsset[], diagnosticCollection: vscode.DiagnosticCollection) {
  const output = vscode.window.createOutputChannel('Crypto Detector');
  output.clear();

  if (assets.length === 0) {
    output.appendLine('✅ No known cryptographic algorithms found.');
    diagnosticCollection.clear();
    output.show(true);
    return;
  }

  const diagnosticsByFile: Map<string, vscode.Diagnostic[]> = new Map();

  for (const a of assets) {
    output.appendLine(`🧩 Algorithm: ${a.name}`);
    output.appendLine(`   • Occurrences: ${a.occurrences}`);
    output.appendLine(`   • Quantum Safety: ${a.quantumSafe}`);
    output.appendLine(`   • Description: ${a.description}`);
    output.appendLine('──────────────────────────────');

    for (const ctx of a.detectionContexts) {
      const severity =
        a.quantumSafe === false
          ? vscode.DiagnosticSeverity.Error
          : a.quantumSafe === 'partial'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Hint;
      for (const line of ctx.lineNumbers) {
        const diag = new vscode.Diagnostic(
          new vscode.Range(new vscode.Position(line - 1, 0), new vscode.Position(line - 1, 100)),
          `${a.name} detected — ${a.quantumSafe}`,
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
    const fileUri = vscode.Uri.file(file);
    diagnosticCollection.set(fileUri, diags);
  }

  output.show(true);
}

export function deactivate() {}
