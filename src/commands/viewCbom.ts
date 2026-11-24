// src/commands/viewCbom.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import { CryptoAsset } from '../parser/types';
import { getDashboardHtml } from '../dashboard';

interface CbomComponent {
  type: string;
  'bom-ref': string;
  name: string;
  cryptoProperties?: {
    assetType?: string;
    algorithmProperties?: {
      primitive?: string;
      parameterSetIdentifier?: string;
      cryptoFunctions?: string[];
    };
  };
  evidence?: {
    occurrences?: Array<{
      location?: string;
      line?: number;
      additionalContext?: string;
    }>;
  };
  properties?: Array<{ name: string; value: string }>;
}

interface CbomFile {
  bomFormat: string;
  specVersion: string;
  components?: CbomComponent[];
}

/**
 * Parse CBOM JSON and convert to CryptoAsset format for visualization
 */
function parseCbomToAssets(cbomPath: string): CryptoAsset[] {
  try {
    const content = fs.readFileSync(cbomPath, 'utf8');
    const cbom: CbomFile = JSON.parse(content);

    if (!cbom.components || cbom.components.length === 0) {
      vscode.window.showWarningMessage('CBOM file contains no cryptographic assets.');
      return [];
    }

    const assets: CryptoAsset[] = [];

    for (const component of cbom.components) {
      if (component.type !== 'cryptographic-asset') continue;

      const props = component.cryptoProperties;
      const algoProps = props?.algorithmProperties;
      const primitive = algoProps?.primitive || 'unknown';
      const customProperties = new Map((component.properties ?? []).map(property => [property.name, property.value]));
      
      // Determine quantum safety based on algorithm name and type
      let quantumSafe: boolean | 'partial' | 'unknown' = 'unknown';
      const name = component.name.toUpperCase();
      const exportedQuantumStatus = customProperties.get('crypto-detector:quantum-status');

      if (exportedQuantumStatus === 'true') quantumSafe = true;
      else if (exportedQuantumStatus === 'false') quantumSafe = false;
      else if (exportedQuantumStatus === 'partial') quantumSafe = 'partial';
      else if (name.includes('KYBER') || name.includes('DILITHIUM') ||
          name.includes('FALCON') || name.includes('SPHINCS')) {
        quantumSafe = true;
      } else if (name.includes('RSA') || name.includes('DSA') || 
                 name.includes('ECDSA') || name.includes('EC') ||
                 name.includes('MD5') || name.includes('SHA1')) {
        quantumSafe = false;
      } else if (name.includes('AES') || name.includes('SHA') || 
                 name.includes('HMAC') || name.includes('CHACHA')) {
        quantumSafe = 'partial';
      }

      // Determine severity
      let severity: 'unknown' | 'none' | 'low' | 'medium' | 'high' = 'unknown';
      let riskScore = 0;

      if (!customProperties.has('crypto-detector:severity') && quantumSafe === false) {
        severity = 'high';
        riskScore = 85;
      } else if (!customProperties.has('crypto-detector:severity') && quantumSafe === 'partial') {
        severity = 'medium';
        riskScore = 50;
      }
      const exportedSeverity = customProperties.get('crypto-detector:severity');
      if (exportedSeverity && ['unknown', 'none', 'low', 'medium', 'high'].includes(exportedSeverity)) {
        severity = exportedSeverity as typeof severity;
      }

      // Handle secret keys as medium risk
      if (props?.assetType === 'related-crypto-material') {
        severity = 'medium';
        riskScore = 45;
      }

      // Extract occurrences
      const occurrences = component.evidence?.occurrences || [];
      const detectionContexts = occurrences.map(occ => ({
        filePath: occ.location || 'unknown',
        lineNumbers: occ.line ? [occ.line] : [],
        snippet: occ.additionalContext || ''
      }));

      assets.push({
        id: component['bom-ref'],
        name: component.name,
        assetType: props?.assetType || 'algorithm',
        primitive,
        type: primitive,
        description: `Detected in CBOM: ${primitive} algorithm`,
        quantumSafe,
        severity,
        classicalSecurityStatus: customProperties.get('crypto-detector:classical-security-status') as any,
        quantumImpact: customProperties.get('crypto-detector:quantum-impact') as any,
        confidence: customProperties.get('crypto-detector:detection-confidence') as any,
        reason: customProperties.get('crypto-detector:assessment'),
        riskScore,
        score: riskScore,
        occurrences: occurrences.length || 1,
        detectionContexts
      });
    }

    return assets;
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to parse CBOM file: ${err.message}`);
    return [];
  }
}

/**
 * Command to visualize an existing CBOM file
 */
export async function viewCbom() {
  const options: vscode.OpenDialogOptions = {
    canSelectMany: false,
    openLabel: 'Open CBOM File',
    filters: {
      'CBOM Files': ['json'],
      'All Files': ['*']
    }
  };

  const fileUri = await vscode.window.showOpenDialog(options);

  if (!fileUri || fileUri.length === 0) {
    return;
  }

  const cbomPath = fileUri[0].fsPath;
  console.log(`📊 Opening CBOM file: ${cbomPath}`);

  const assets = parseCbomToAssets(cbomPath);

  if (assets.length === 0) {
    vscode.window.showWarningMessage('No cryptographic assets found in CBOM file.');
    return;
  }

  vscode.window.showInformationMessage(
    `✅ Loaded ${assets.length} cryptographic asset(s) from CBOM`
  );

  // Show dashboard with parsed assets
  const panel = vscode.window.createWebviewPanel(
    'cbomViewer',
    `CBOM Viewer - ${cbomPath.split(/[/\\]/).pop()}`,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = getDashboardHtml(assets);
}
