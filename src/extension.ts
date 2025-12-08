/* src/extension.ts
   VS Code extension entrypoint that reuses the shared scan engine.
*/

import * as vscode from 'vscode';
import * as path from 'path';
import {
  scanFile,
  scanFolder,
  scanGithubRepo,
  generateCBOM,
  generateDashboardHtml,
  openInBrowser
} from './core/scan-engine';

export function activate(context: vscode.ExtensionContext) {
  // Use globalStorage for default output directory if available
  const defaultOutBase = context.globalStorageUri ? context.globalStorageUri.fsPath : path.join(context.extensionPath, 'crypto-analysis');

  /* ---------- Command: Scan File (uses active editor or explicit uri) ---------- */
  const scanFileCmd = vscode.commands.registerCommand('crypto-detector.scan-file', async (uri?: vscode.Uri) => {
    try {
      const editor = vscode.window.activeTextEditor;
      const fileUri = uri ?? editor?.document.uri;
      if (!fileUri) { vscode.window.showErrorMessage('No file to scan. Open a file or use the explorer context menu.'); return; }
      const filePath = fileUri.fsPath;
      const assets = await scanFile(filePath);

      const outDir = path.join(defaultOutBase, 'vscode-file');
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(outDir));
      const cbomPath = path.join(outDir, `${path.basename(filePath)}-cbom.json`);
      await generateCBOM(assets, cbomPath);
      const dashboardPath = path.join(outDir, `${path.basename(filePath)}-dashboard.html`);
      generateDashboardHtml(assets, dashboardPath);

      openInBrowser(dashboardPath);
      vscode.window.showInformationMessage(`Scan complete: ${assets.length} detection(s). Dashboard: ${dashboardPath}`);
    } catch (err: any) {
      vscode.window.showErrorMessage('Scan failed: ' + (err.message || err));
    }
  });

  /* ---------- Command: Scan Workspace (first workspace folder) ---------- */
  const scanWorkspaceCmd = vscode.commands.registerCommand('crypto-detector.scan-workspace', async () => {
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) { vscode.window.showErrorMessage('Open a workspace folder first.'); return; }
      const root = folders[0].uri.fsPath;
      const assets = await scanFolder(root);

      const outDir = path.join(defaultOutBase, 'vscode-workspace');
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(outDir));
      const cbomPath = path.join(outDir, `workspace-cbom.json`);
      await generateCBOM(assets, cbomPath);
      const dashboardPath = path.join(outDir, `workspace-dashboard.html`);
      generateDashboardHtml(assets, dashboardPath);

      openInBrowser(dashboardPath);
      vscode.window.showInformationMessage(`Workspace scan complete: ${assets.length} detections`);
    } catch (err: any) {
      vscode.window.showErrorMessage('Workspace scan failed: ' + (err.message || err));
    }
  });

  /* ---------- Command: Scan GitHub ---------- */
  const scanGithubCmd = vscode.commands.registerCommand('crypto-detector.scan-github', async () => {
    try {
      const repoUrl = await vscode.window.showInputBox({ prompt: 'Enter GitHub repo URL (https://github.com/user/repo or git@github.com:user/repo.git)' });
      if (!repoUrl) return;
      const { assets, repoPath } = await scanGithubRepo(repoUrl);

      const outDir = path.join(defaultOutBase, 'vscode-github');
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(outDir));
      const repoName = path.basename(repoPath);
      const cbomPath = path.join(outDir, `${repoName}-cbom.json`);
      await generateCBOM(assets, cbomPath);
      const dashboardPath = path.join(outDir, `${repoName}-dashboard.html`);
      generateDashboardHtml(assets, dashboardPath);

      openInBrowser(dashboardPath);
      vscode.window.showInformationMessage(`GitHub scan complete: ${assets.length} detections`);
    } catch (err: any) {
      vscode.window.showErrorMessage('GitHub scan failed: ' + (err.message || err));
    }
  });

  /* ---------- Command: Export CBOM (helper) ---------- */
  const exportCbomCmd = vscode.commands.registerCommand('crypto-detector.export-cbom', async () => {
    vscode.window.showInformationMessage('Use the CLI `export-cbom <inputJson>` to convert a raw scan_json into a CycloneDX CBOM file.');
  });

  /* ---------- Command: Show Dashboard (open HTML file) ---------- */
  const showDashboardCmd = vscode.commands.registerCommand('crypto-detector.show-dashboard', async () => {
    const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'HTML': ['html'] } });
    if (!files || files.length === 0) return;
    openInBrowser(files[0].fsPath);
  });

  context.subscriptions.push(scanFileCmd, scanWorkspaceCmd, scanGithubCmd, exportCbomCmd, showDashboardCmd);
}

export function deactivate() {
  // nothing to clean up currently
}
