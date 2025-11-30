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

    // Build evidence array with proper structure
    const evidenceOccurrences = (a.detectionContexts ?? []).map(ctx => ({
      location: ctx.filePath ?? 'unknown',
      lineNumbers: ctx.lineNumbers ?? [],
      snippet: (ctx.snippet ?? '').substring(0, 300)
    }));

    return {
      type: 'cryptographic-asset',
      'bom-ref': a.id ?? `${(a.name ?? 'unknown').toLowerCase()}-${i}`,
      name: a.name ?? 'Unknown',
      evidence: {
        occurrences: evidenceOccurrences
      },
      cryptoProperties: {
        assetType: a.assetType ?? 'algorithm',
        algorithmProperties: {
          primitive: a.primitive ?? a.type ?? 'unknown',
          cryptoFunctions: [a.description ?? 'unknown']
        },
        quantumSafe: String(a.quantumSafe ?? 'unknown'),
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
  
  try {
    await fs.writeFile(outPath, JSON.stringify(cbom, null, 2), 'utf8');
    return outPath;
  } catch (err) {
    console.error('[writeCbomJson] Failed to write file:', err);
    throw new Error(`Failed to write CBOM file: ${err}`);
  }
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
        `📦 CBOM generated: ${path.basename(outPath)}`,
        'Open File',
        'Reveal in Explorer'
      )
      .then(async choice => {
        if (choice === 'Open File') {
          try {
            const doc = await vscode.workspace.openTextDocument(outPath);
            await vscode.window.showTextDocument(doc);
          } catch (err) {
            console.error('[generateAndDownloadCbom] Failed to open file:', err);
            vscode.window.showErrorMessage('Failed to open CBOM file.');
          }
        } else if (choice === 'Reveal in Explorer') {
          try {
            await vscode.commands.executeCommand(
              'revealFileInOS',
              vscode.Uri.file(outPath)
            );
          } catch (err) {
            console.error('[generateAndDownloadCbom] Failed to reveal in explorer:', err);
          }
        }
      });
  } catch (err: any) {
    vscode.window.showErrorMessage(`❌ Failed to generate CBOM: ${err.message}`);
  }
}