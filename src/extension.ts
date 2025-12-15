// src/extension.ts — Fixed and Complete
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { scanFile, scanFolder, scanGithubRepo, generateCBOM, generateDashboardHtml, openInBrowser } from "./core/scan-engine";
import * as parser from "./parser";
import * as highlighter from "./highlighter";
import { getIBMStyleDashboard } from "./dashboard-ibm";
import { generateAndDownloadCbom } from "./parser/report-writer";

export function activate(context: vscode.ExtensionContext) {
  console.log("🔐 Crypto Detector Extension Activated");

  // Register highlighter
  highlighter.registerHighlighter(context);

  /* ---------------------------------------------------
     CMD: Scan Current File
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.scan-file", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return vscode.window.showErrorMessage("❌ No active file to scan.");
      }

      const filePath = editor.document.uri.fsPath;
      console.log(`📄 Scanning file: ${filePath}`);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "🔍 Scanning file for crypto algorithms...",
          cancellable: false
        },
        async (progress) => {
          try {
            // Use parser module for consistency
            const assets = await parser.detectInDocument(editor.document.uri);

            if (assets.length === 0) {
              vscode.window.showInformationMessage("✅ No cryptographic algorithms detected in this file.");
              return;
            }

            // Apply highlights
            await highlighter.applyHighlights(assets);

            // Show dashboard
            const panel = vscode.window.createWebviewPanel(
              'cryptoDashboard',
              `Crypto Analysis - ${path.basename(filePath)}`,
              vscode.ViewColumn.One,
              { enableScripts: true, retainContextWhenHidden: true }
            );

            panel.webview.html = getIBMStyleDashboard(assets);

            panel.webview.onDidReceiveMessage(async (message) => {
              if (message.command === 'generateCbom') {
                await generateAndDownloadCbom(assets);
              }
            });

            vscode.window.showInformationMessage(
              `✅ Found ${assets.length} cryptographic algorithm(s) in ${path.basename(filePath)}`
            );
          } catch (err: any) {
            console.error("Scan file error:", err);
            vscode.window.showErrorMessage(`❌ Scan failed: ${err.message}`);
          }
        }
      );
    })
  );

  /* ---------------------------------------------------
     CMD: Scan Workspace
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.scan-workspace", async () => {
      if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return vscode.window.showErrorMessage("❌ No workspace folder is open.");
      }

      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
      console.log(`📁 Scanning workspace: ${root}`);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "🔍 Scanning workspace...",
          cancellable: true
        },
        async (progress, token) => {
          try {
            let processed = 0;
            
            const assets = await parser.scanWorkspace(
              (p) => {
                processed = p.processed;
                progress.report({
                  message: `Scanned ${p.processed}/${p.total || '?'} files`,
                  increment: p.total ? (1 / p.total) * 100 : undefined
                });
              },
              token
            );

            if (token.isCancellationRequested) {
              vscode.window.showWarningMessage("⚠️ Workspace scan cancelled.");
              return;
            }

            if (assets.length === 0) {
              vscode.window.showInformationMessage("✅ No cryptographic algorithms detected in workspace.");
              return;
            }

            // Apply highlights
            await highlighter.applyHighlights(assets);

            // Show dashboard
            const panel = vscode.window.createWebviewPanel(
              'cryptoDashboard',
              'Crypto Analysis - Workspace',
              vscode.ViewColumn.One,
              { enableScripts: true, retainContextWhenHidden: true }
            );

            panel.webview.html = getIBMStyleDashboard(assets);

            panel.webview.onDidReceiveMessage(async (message) => {
              if (message.command === 'generateCbom') {
                await generateAndDownloadCbom(assets);
              }
            });

            vscode.window.showInformationMessage(
              `✅ Workspace scan complete! Found ${assets.length} cryptographic algorithm(s).`
            );
          } catch (err: any) {
            console.error("Workspace scan error:", err);
            vscode.window.showErrorMessage(`❌ Workspace scan failed: ${err.message}`);
          }
        }
      );
    })
  );

  /* ---------------------------------------------------
     CMD: Scan GitHub Repo
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.scan-github", async () => {
      const repoUrl = await vscode.window.showInputBox({
        prompt: "Enter GitHub repository URL",
        placeHolder: "https://github.com/username/repository",
        validateInput: (value) => {
          if (!value) return "URL is required";
          if (!value.includes("github.com")) return "Must be a GitHub URL";
          return null;
        }
      });

      if (!repoUrl) return;

      const outputDir = path.join(os.tmpdir(), "crypto-detector-github");

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "🐙 Cloning and scanning GitHub repository...",
          cancellable: false
        },
        async (progress) => {
          try {
            const result = await scanGithubRepo(repoUrl, outputDir);

            vscode.window.showInformationMessage(
              `✅ GitHub scan complete!\n${result.detections} detections in ${result.codeFiles} files.`
            );

            // Open dashboard in browser
            openInBrowser(result.dashboardPath);

          } catch (err: any) {
            console.error("GitHub scan error:", err);
            vscode.window.showErrorMessage(`❌ GitHub scan failed: ${err.message}`);
          }
        }
      );
    })
  );

  /* ---------------------------------------------------
     CMD: Export CBOM
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.export-cbom", async () => {
      if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return vscode.window.showErrorMessage("❌ Open a workspace to export CBOM.");
      }

      const root = vscode.workspace.workspaceFolders[0].uri.fsPath;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "📦 Generating CBOM...",
          cancellable: false
        },
        async (progress) => {
          try {
            progress.report({ message: "Scanning workspace..." });
            const assets = await parser.scanWorkspace();

            if (assets.length === 0) {
              vscode.window.showInformationMessage("✅ No cryptographic algorithms detected.");
              return;
            }

            progress.report({ message: "Exporting CBOM..." });

            const saveUri = await vscode.window.showSaveDialog({
              filters: { "CBOM JSON": ["json"] },
              defaultUri: vscode.Uri.file(path.join(root, "cbom.json"))
            });

            if (!saveUri) return;

            await generateCBOM(assets, saveUri.fsPath);

            const choice = await vscode.window.showInformationMessage(
              `✅ CBOM exported: ${path.basename(saveUri.fsPath)}`,
              "Open File",
              "Reveal in Explorer"
            );

            if (choice === "Open File") {
              const doc = await vscode.workspace.openTextDocument(saveUri.fsPath);
              await vscode.window.showTextDocument(doc);
            } else if (choice === "Reveal in Explorer") {
              await vscode.commands.executeCommand("revealFileInOS", saveUri);
            }
          } catch (err: any) {
            console.error("Export CBOM error:", err);
            vscode.window.showErrorMessage(`❌ Failed to export CBOM: ${err.message}`);
          }
        }
      );
    })
  );

  /* ---------------------------------------------------
     CMD: Show Dashboard
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.show-dashboard", async () => {
      if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return vscode.window.showErrorMessage("❌ Open a workspace to show dashboard.");
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "📊 Generating dashboard...",
          cancellable: false
        },
        async (progress) => {
          try {
            progress.report({ message: "Scanning workspace..." });
            const assets = await parser.scanWorkspace();

            if (assets.length === 0) {
              vscode.window.showInformationMessage("✅ No cryptographic algorithms detected.");
              return;
            }

            // Show dashboard in webview
            const panel = vscode.window.createWebviewPanel(
              'cryptoDashboard',
              'Crypto Analysis Dashboard',
              vscode.ViewColumn.One,
              { enableScripts: true, retainContextWhenHidden: true }
            );

            panel.webview.html = getIBMStyleDashboard(assets);

            panel.webview.onDidReceiveMessage(async (message) => {
              if (message.command === 'generateCbom') {
                await generateAndDownloadCbom(assets);
              }
            });

          } catch (err: any) {
            console.error("Show dashboard error:", err);
            vscode.window.showErrorMessage(`❌ Failed to show dashboard: ${err.message}`);
          }
        }
      );
    })
  );

  console.log("✅ All commands registered successfully");
}

export function deactivate() {
  highlighter.clearHighlights();
  console.log("🔐 Crypto Detector Extension Deactivated");
}