// src/parser/report-writer.ts
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { CryptoAsset } from './types';

/**
 * Generate IBM-compliant CycloneDX CBOM (Cryptographic Bill of Materials)
 * Following the CycloneDX 1.6 specification for cryptographic assets
 */
export async function writeCbomJson(
  assets: CryptoAsset[],
  workspaceFolder?: vscode.WorkspaceFolder
): Promise<string> {
  
  if (!workspaceFolder) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      throw new Error('No workspace folder is open.');
    }
    workspaceFolder = folders[0];
  }

  const bomRef = `urn:uuid:${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();

  // Build CycloneDX 1.6 compliant CBOM
  const cbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: bomRef,
    version: 1,
    metadata: {
      timestamp,
      tools: {
        components: [
          {
            type: 'application',
            name: 'Crypto Detector for VS Code',
            version: '0.0.2',
            author: 'Syed Shail',
            publisher: 'syedshail'
          }
        ]
      },
      component: {
        type: 'application',
        'bom-ref': bomRef,
        name: path.basename(workspaceFolder.uri.fsPath),
        description: 'Cryptographic Bill of Materials for project'
      }
    },
    components: assets.map((asset, idx) => {
      const componentBomRef = `crypto-asset-${idx}`;
      
      return {
        'bom-ref': componentBomRef,
        type: 'cryptographic-asset',
        name: asset.name,
        description: asset.description || `${asset.primitive} cryptographic algorithm`,
        cryptoProperties: {
          assetType: mapAssetType(asset.assetType),
          algorithmProperties: {
            primitive: mapPrimitive(asset.primitive),
            ...(asset.parameter && { parameterSetIdentifier: asset.parameter }),
            ...(asset.keySize && { 
              executionEnvironment: 'software-plain-ram',
              implementationPlatform: 'x86_64'
            }),
            ...(asset.quantumSafe !== undefined && {
              certificationLevel: ['none'],
              mode: mapQuantumSafetyToMode(asset.quantumSafe),
              padding: 'none'
            }),
            cryptoFunctions: [mapCryptoFunction(asset.primitive)]
          },
          ...(asset.oid && { oid: asset.oid })
        },
        properties: [
          {
            name: 'quantum-safe',
            value: String(asset.quantumSafe ?? 'unknown')
          },
          {
            name: 'severity',
            value: asset.severity ?? 'unknown'
          },
          {
            name: 'risk-score',
            value: String(asset.riskScore ?? 0)
          },
          {
            name: 'occurrences',
            value: String(asset.occurrences)
          }
        ],
        evidence: {
          occurrences: asset.detectionContexts.map(ctx => ({
            location: ctx.filePath,
            ...(ctx.lineNumbers && ctx.lineNumbers.length > 0 && {
              line: ctx.lineNumbers[0],
              offset: 0
            }),
            ...(ctx.snippet && { 
              additionalContext: ctx.snippet.substring(0, 100)
            })
          }))
        }
      };
    })
  };

  // Write to file
  const outPath = path.join(
    workspaceFolder.uri.fsPath,
    `cbom_${Date.now()}.json`
  );
  
  await fs.writeFile(outPath, JSON.stringify(cbom, null, 2), 'utf8');
  console.log(`📝 CBOM written to: ${outPath}`);
  
  return outPath;
}

/**
 * Map internal asset types to CycloneDX spec
 */
function mapAssetType(type: string): string {
  const mapping: Record<string, string> = {
    'algorithm': 'algorithm',
    'certificate': 'certificate',
    'protocol': 'protocol',
    'related-crypto-material': 'related-crypto-material'
  };
  return mapping[type] || 'algorithm';
}

/**
 * Map primitive types to CycloneDX crypto primitives
 */
function mapPrimitive(primitive: string): string {
  const mapping: Record<string, string> = {
    'hash': 'hash',
    'symmetric': 'ae',
    'cipher': 'ae',
    'asymmetric': 'pke',
    'mac': 'mac',
    'pqc': 'pke',
    'signature': 'signature',
    'kdf': 'kdf',
    'other': 'other'
  };
  return mapping[primitive.toLowerCase()] || 'other';
}

/**
 * Map quantum safety status to execution mode
 */
function mapQuantumSafetyToMode(quantumSafe: boolean | 'partial' | 'unknown'): string {
  if (quantumSafe === true) return 'pqc-secure';
  if (quantumSafe === 'partial') return 'hybrid';
  return 'classical';
}

/**
 * Map primitive to crypto function
 */
function mapCryptoFunction(primitive: string): string {
  const mapping: Record<string, string> = {
    'hash': 'digest',
    'symmetric': 'encrypt',
    'cipher': 'encrypt',
    'asymmetric': 'keygen',
    'mac': 'tag',
    'signature': 'sign',
    'kdf': 'keyderive'
  };
  return mapping[primitive.toLowerCase()] || 'unknown';
}

/**
 * Helper function to generate and save CBOM, then notify user
 */
export async function generateAndDownloadCbom(assets: CryptoAsset[]): Promise<void> {
  if (assets.length === 0) {
    vscode.window.showInformationMessage('✅ No cryptographic assets detected to include in CBOM.');
    return;
  }

  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const outPath = await writeCbomJson(assets, folder);

    vscode.window
      .showInformationMessage(
        `📦 CBOM generated: ${path.basename(outPath)}`,
        'Open File',
        'Reveal in Explorer'
      )
      .then(async choice => {
        if (choice === 'Open File') {
          const doc = await vscode.workspace.openTextDocument(outPath);
          await vscode.window.showTextDocument(doc);
        } else if (choice === 'Reveal in Explorer') {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outPath));
        }
      });
  } catch (err: any) {
    vscode.window.showErrorMessage(`❌ Failed to generate CBOM: ${err.message}`);
    console.error('CBOM generation error:', err);
  }
}