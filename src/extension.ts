// src/extension.ts — Fixed with HTML dashboards for all commands
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { scanFile, scanFolder, scanGithubRepo, generateCBOM, generateDashboardHtml, openInBrowser, normalizeGithubRepoUrl } from "./core/scan-engine";
import * as parser from "./parser";
import * as highlighter from "./highlighter";
import { CryptoAsset } from "./parser/types";

export function activate(context: vscode.ExtensionContext) {
  // Reuse results for unchanged files between workspace scans.
  parser.setCacheDirectory(context.globalStorageUri.fsPath);
  console.log("🔐 Crypto Detector Extension Activated");

  const diagnostics = vscode.languages.createDiagnosticCollection("crypto-detector");
  context.subscriptions.push(diagnostics);

  function publishDiagnostics(assets: CryptoAsset[], clearScope?: string) {
    const normalizedScope = clearScope ? path.resolve(clearScope) : undefined;
    const staleUris: vscode.Uri[] = [];
    diagnostics.forEach(uri => {
      const filePath = path.resolve(uri.fsPath);
      if (!normalizedScope || filePath === normalizedScope || filePath.startsWith(`${normalizedScope}${path.sep}`)) {
        staleUris.push(uri);
      }
    });
    staleUris.forEach(uri => diagnostics.delete(uri));
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const asset of assets) {
      const filePath = asset.source || asset.detectionContexts?.[0]?.filePath;
      const lineNumber = asset.line || asset.detectionContexts?.[0]?.lineNumbers?.[0];
      if (!filePath || !lineNumber || lineNumber < 1) continue;

      const uri = vscode.Uri.file(filePath);
      const context = asset.detectionContexts?.find(item => item.filePath === filePath);
      const column = Math.max(asset.column ?? 0, 0);
      const range = new vscode.Range(lineNumber - 1, column, lineNumber - 1, column + 1);
      const confidence = asset.confidence ?? "unknown";
      const quantumImpact = asset.quantumImpact ?? asset.quantumSafe ?? "unknown";
      const message = [
        `${asset.name} cryptographic usage`,
        `Classical status: ${asset.classicalSecurityStatus ?? "unknown"}`,
        `Quantum impact: ${quantumImpact}`,
        `Detection: ${asset.detectionMethod ?? "unspecified"} (${confidence} confidence)`,
        asset.reason
      ].filter(Boolean).join(" · ");

      const severity = confidence === "low" || confidence === "unknown"
        ? vscode.DiagnosticSeverity.Hint
        : confidence === "medium"
          ? vscode.DiagnosticSeverity.Information
        : asset.severity === "high"
          ? vscode.DiagnosticSeverity.Error
          : asset.severity === "medium"
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Information;
      const diagnostic = new vscode.Diagnostic(range, message, severity);
      diagnostic.source = "Crypto Detector";
      diagnostic.code = `crypto-${(asset.name || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const entries = byFile.get(uri.fsPath) ?? [];
      entries.push(diagnostic);
      byFile.set(uri.fsPath, entries);
    }

    for (const [filePath, entries] of byFile) {
      diagnostics.set(vscode.Uri.file(filePath), entries);
    }
  }

  // Register highlighter
  highlighter.registerHighlighter(context);

  /* ---------------------------------------------------
     CMD: Scan Current File - Opens HTML Dashboard
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
            const assets = await parser.detectInDocument(editor.document.uri);
            publishDiagnostics(assets, filePath);

            if (assets.length === 0) {
              vscode.window.showInformationMessage("✅ No cryptographic algorithms detected in this file.");
              return;
            }

            // Apply highlights
            await highlighter.applyHighlights(assets);

            // Generate and open HTML dashboard
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-detector-'));
            const dashboardPath = path.join(tempDir, 'dashboard.html');
            
            generateDashboardHtml(assets, dashboardPath);
            openInBrowser(dashboardPath);

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
     CMD: Scan Workspace - Opens HTML Dashboard
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

            publishDiagnostics(assets, root);

            if (assets.length === 0) {
              vscode.window.showInformationMessage("✅ No cryptographic algorithms detected in workspace.");
              return;
            }

            // Apply highlights
            await highlighter.applyHighlights(assets);

            // Generate and open HTML dashboard
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-detector-'));
            const dashboardPath = path.join(tempDir, 'dashboard.html');
            
            generateDashboardHtml(assets, dashboardPath);
            openInBrowser(dashboardPath);

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
     CMD: Scan GitHub Repo - Opens HTML Dashboard
  --------------------------------------------------- */
  context.subscriptions.push(
    vscode.commands.registerCommand("crypto-detector.scan-github", async () => {
      const repoUrl = await vscode.window.showInputBox({
        prompt: "Enter GitHub repository URL",
        placeHolder: "https://github.com/username/repository",
        validateInput: (value) => {
          if (!value) return "URL is required";
          try {
            normalizeGithubRepoUrl(value);
            return null;
          } catch (err: any) {
            return err.message;
          }
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

            await generateCBOM(assets, saveUri.fsPath, root);

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
     CMD: Show Dashboard - Opens HTML Dashboard
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

            // Generate and open HTML dashboard
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-detector-'));
            const dashboardPath = path.join(tempDir, 'dashboard.html');
            
            generateDashboardHtml(assets, dashboardPath);
            openInBrowser(dashboardPath);

            vscode.window.showInformationMessage(
              `✅ Dashboard opened with ${assets.length} detections`
            );
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
