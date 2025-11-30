// src/commands/importCbom.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import { CryptoAsset, Severity } from '../parser/types';
import { getIBMStyleDashboard } from '../dashboard-ibm';
import { generateAndDownloadCbom } from '../parser/report-writer';

interface CbomComponent {
  name?: string;
  type?: string;
  cryptoProperties?: {
    assetType?: string;
    algorithmProperties?: {
      primitive?: string;
      cryptoFunctions?: string[];
    };
    quantumSafe?: string | boolean;
    severity?: string;
    riskScore?: number;
  };
  evidence?: {
    occurrences?: Array<{
      location?: string;
      lineNumbers?: number[];
      snippet?: string;
    }>;
  };
}

interface CbomFile {
  components?: CbomComponent[];
}

/**
 * Import and analyze an existing CBOM file
 */
export async function importCbom() {
  // Let user select a CBOM file
  const fileUri = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: {
      'CBOM Files': ['json'],
      'All Files': ['*']
    },
    openLabel: 'Import CBOM'
  });

  if (!fileUri || fileUri.length === 0) {
    return;
  }

  const filePath = fileUri[0].fsPath;

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const cbom: CbomFile = JSON.parse(content);

    if (!cbom.components || cbom.components.length === 0) {
      vscode.window.showWarningMessage('⚠️ No components found in CBOM file.');
      return;
    }

    // Convert CBOM components to CryptoAsset format
    const assets: CryptoAsset[] = cbom.components.map((comp, index) => {
      const name = comp.name || `Unknown-${index}`;
      const primitive = comp.cryptoProperties?.algorithmProperties?.primitive || 
                       comp.cryptoProperties?.assetType || 
                       'unknown';
      
      let quantumSafe: boolean | 'partial' | 'unknown' = 'unknown';
      const qsValue = comp.cryptoProperties?.quantumSafe;
      if (qsValue === true || qsValue === 'true') quantumSafe = true;
      else if (qsValue === false || qsValue === 'false') quantumSafe = false;
      else if (qsValue === 'partial') quantumSafe = 'partial';

      const severity = (comp.cryptoProperties?.severity?.toLowerCase() || 'unknown') as Severity;
      const riskScore = comp.cryptoProperties?.riskScore || 0;

      const detectionContexts = comp.evidence?.occurrences?.map(occ => ({
        filePath: occ.location,
        lineNumbers: occ.lineNumbers,
        snippet: occ.snippet
      })) || [];

      return {
        name,
        type: primitive,
        primitive,
        assetType: comp.cryptoProperties?.assetType || 'algorithm',
        description: comp.cryptoProperties?.algorithmProperties?.cryptoFunctions?.[0] || '',
        quantumSafe,
        severity,
        score: riskScore,
        riskScore,
        reason: `Imported from CBOM`,
        source: filePath,
        occurrences: detectionContexts.length || 1,
        id: `cbom:${name.toLowerCase()}-${index}`,
        detectionContexts
      };
    });

    vscode.window.showInformationMessage(
      `✅ Imported ${assets.length} cryptographic assets from CBOM file.`
    );

    // Show dashboard with imported data
    const panel = vscode.window.createWebviewPanel(
      'cryptoDashboard',
      'IBM CBOM — Imported Analysis',
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
    vscode.window.showErrorMessage(`❌ Failed to import CBOM: ${err.message}`);
  }
}