// src/extension.ts — Final Unified VS Code Entry
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import { scanFile, scanFolder, scanGithubRepo, generateCBOM, generateDashboardHtml, openInBrowser } from "./core/scan-engine";

export function activate(context: vscode.ExtensionContext) {
  console.log("Crypto Detector Extension Activated");

  /* ---------------------------------------------------
     CMD: Scan Current File
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.scan-file", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return vscode.window.showErrorMessage("No active file.");

      const filePath = editor.document.uri.fsPath;

      const assets = await scanFile(filePath);

      const outputDir = path.join(os.tmpdir(), "crypto-detector-file");
      const dashboard = path.join(outputDir, "dashboard-file.html");
      const cbom = path.join(outputDir, "cbom-file.json");

      generateDashboardHtml(assets, dashboard);
      await generateCBOM(assets, cbom);

      vscode.window.showInformationMessage(`Scan complete. Dashboard: ${dashboard}`);
      openInBrowser(dashboard);
    })
  );

  /* ---------------------------------------------------
     CMD: Scan Workspace
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.scan-workspace", async () => {
      if (!vscode.workspace.workspaceFolders) {
        return vscode.window.showErrorMessage("No workspace open.");
      }

      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;

      const assets = await scanFolder(root);

      const outputDir = path.join(os.tmpdir(), "crypto-detector-workspace");
      const dashboard = path.join(outputDir, "dashboard-workspace.html");
      const cbom = path.join(outputDir, "cbom-workspace.json");

      generateDashboardHtml(assets, dashboard);
      await generateCBOM(assets, cbom);

      vscode.window.showInformationMessage(`Workspace scan complete. Dashboard: ${dashboard}`);
      openInBrowser(dashboard);
    })
  );

  /* ---------------------------------------------------
     CMD: Scan GitHub Repo
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.scan-github", async () => {
      const repoUrl = await vscode.window.showInputBox({ prompt: "Enter GitHub repository URL" });
      if (!repoUrl) return;

      const outputDir = path.join(os.tmpdir(), "crypto-detector-github");

      const result = await scanGithubRepo(repoUrl, outputDir);

      vscode.window.showInformationMessage(
        `GitHub Scan Finished — ${result.detections} detections.\nDashboard: ${result.dashboardPath}`
      );

      openInBrowser(result.dashboardPath);
    })
  );

  /* ---------------------------------------------------
     CMD: Export CBOM
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.export-cbom", async () => {
      if (!vscode.workspace.workspaceFolders)
        return vscode.window.showErrorMessage("Open a workspace to export CBOM.");

      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;

      const assets = await scanFolder(root);

      const saveUri = await vscode.window.showSaveDialog({ filters: { JSON: ["json"] }, defaultUri: vscode.Uri.file("cbom.json") });
      if (!saveUri) return;

      await generateCBOM(assets, saveUri.fsPath);

      vscode.window.showInformationMessage(`CBOM exported: ${saveUri.fsPath}`);
    })
  );

  /* ---------------------------------------------------
     CMD: Show Dashboard
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.show-dashboard", async () => {
      if (!vscode.workspace.workspaceFolders)
        return vscode.window.showErrorMessage("Open a workspace to show dashboard.");

      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;

      const assets = await scanFolder(root);

      const dashboardPath = path.join(os.tmpdir(), "crypto-detector-dashboard.html");
      generateDashboardHtml(assets, dashboardPath);

      vscode.window.showInformationMessage(`Dashboard generated: ${dashboardPath}`);
      openInBrowser(dashboardPath);
    })
  );
}

export function deactivate() {}
