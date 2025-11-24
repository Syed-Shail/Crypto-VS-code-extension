// src/parser/report-writer.ts
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { CryptoAsset } from './types';

/* --------------------------------------------------------------------------
 * 🧩 CBOM (Cryptographic Bill of Materials) Report Generator
 * -------------------------------------------------------------------------- */
export async function writeCbomJson(
  assets: CryptoAsset[],
  workspaceFolder?: vscode.WorkspaceFolder
) {
  if (!workspaceFolder) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error('No workspace folder is open.');
    }
    workspaceFolder = folders[0];
  }

  const components = assets.map((a, i) => {
    const occurrences = (a.detectionContexts ?? []).flatMap(ctx => ctx.lineNumbers ?? []).length > 0
      ? (a.detectionContexts ?? []).flatMap(ctx => ctx.lineNumbers ?? []).length
      : a.occurrences ?? 1;

    return {
      type: 'cryptographic-asset',
      'bom-ref': a.id ?? `${(a.name ?? 'unknown').toLowerCase()}-${i}`,
      name: a.name,
      evidence: {
        occurrences: (a.detectionContexts ?? []).map(ctx => ({
          location: ctx.filePath,
          lineNumbers: ctx.lineNumbers,
          snippet: ctx.snippet
        }))
      },
      cryptoProperties: {
        assetType: a.assetType ?? 'algorithm',
        algorithmProperties: {
          primitive: a.primitive ?? a.type ?? 'unknown',
          cryptoFunctions: [a.description ?? 'unknown']
        },
        quantumSafe: a.quantumSafe ?? 'unknown',
        severity: a.severity ?? 'unknown',
        riskScore: a.riskScore ?? a.score ?? 0
      }
    };
  });

  const cbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: 'Syed Shail',
          name: 'Crypto Detector for VS Code',
          version: '1.0.0'
        }
      ]
    },
    components,
    statistics: {
      totalDetected: assets.length,
      highRisk: assets.filter(a => a.severity === 'high').length,
      mediumRisk: assets.filter(a => a.severity === 'medium').length,
      lowRisk: assets.filter(a => a.severity === 'low').length
    }
  };

  const outPath = path.join(
    workspaceFolder.uri.fsPath,
    `crypto_cbom_${Date.now()}.json`
  );
  await fs.writeFile(outPath, JSON.stringify(cbom, null, 2), 'utf8');

  return outPath;
}

/* --------------------------------------------------------------------------
 * 🧾 Helper: Save Report and Notify User
 * -------------------------------------------------------------------------- */
export async function generateAndDownloadCbom(
  assets: CryptoAsset[]
): Promise<void> {
  if (assets.length === 0) {
    vscode.window.showInformationMessage(
      '✅ No cryptographic assets detected to include in CBOM.'
    );
    return;
  }

  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const outPath = await writeCbomJson(assets, folder);

    // Show message + open the generated file
    vscode.window
      .showInformationMessage(
        `📦 CBOM generated: ${path.basename(
          outPath
        )}`,
        'Open File',
        'Reveal in Explorer'
      )
      .then(async choice => {
        if (choice === 'Open File') {
          const doc = await vscode.workspace.openTextDocument(outPath);
          vscode.window.showTextDocument(doc);
        } else if (choice === 'Reveal in Explorer') {
          vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(outPath)
          );
        }
      });
  } catch (err: any) {
    vscode.window.showErrorMessage(`❌ Failed to generate CBOM: ${err.message}`);
  }
}
