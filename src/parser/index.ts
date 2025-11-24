// src/parser/index.ts
import * as vscode from 'vscode';
import { DetectorPlugin } from './js-detector';
import { jsDetector } from './js-detector';
import { regexDetector } from './regex-detector';
import { CryptoAsset } from './types';

// Unified plugin registry
const plugins: DetectorPlugin[] = [
  jsDetector,
  regexDetector
];

/**
 * Select appropriate detector based on file extension and language
 */
function getDetectorForUri(uri: vscode.Uri): DetectorPlugin {
  const ext = uri.fsPath.match(/\.[^.]+$/)?.[0]?.toLowerCase() || '';
  
  // Try to match by extension first
  for (const plugin of plugins) {
    if (plugin.extensions?.includes(ext)) {
      return plugin;
    }
  }
  
  // Fallback to regex detector for all other files
  return regexDetector;
}

/**
 * Detect crypto algorithms in a single document
 */
export async function detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const detector = getDetectorForUri(uri);
  console.log(`📄 Using ${detector === jsDetector ? 'JS' : 'Regex'} detector for ${uri.fsPath}`);
  
  try {
    return await detector.detectInDocument(uri);
  } catch (err: any) {
    console.error(`❌ Error detecting in ${uri.fsPath}:`, err);
    return [];
  }
}

/**
 * Scan entire workspace for crypto algorithms
 */
export async function scanWorkspace(
  onProgress?: (p: { processed: number; total?: number }) => void,
  token?: vscode.CancellationToken
): Promise<CryptoAsset[]> {
  
  // Find all relevant files
  const files = await vscode.workspace.findFiles(
    '**/*.{js,jsx,ts,tsx,py,java,cpp,c,h,rs,go}',
    '**/node_modules/**'
  );
  
  const total = files.length;
  const assetMap: Record<string, CryptoAsset> = {};
  let processed = 0;

  console.log(`📦 Scanning ${total} files in workspace...`);

  for (const uri of files) {
    if (token?.isCancellationRequested) {
      console.log('⚠️ Scan cancelled by user');
      break;
    }

    try {
      const detector = getDetectorForUri(uri);
      const assets = await detector.detectInDocument(uri);
      
      // Merge results by ID
      for (const asset of assets) {
        if (!assetMap[asset.id]) {
          assetMap[asset.id] = { ...asset };
        } else {
          // Merge occurrences and contexts
          assetMap[asset.id].occurrences += asset.occurrences;
          assetMap[asset.id].detectionContexts.push(...asset.detectionContexts);
        }
      }
    } catch (err: any) {
      console.warn(`⚠️ Failed to scan ${uri.fsPath}:`, err.message);
    }

    processed++;
    onProgress?.({ processed, total });
  }

  const results = Object.values(assetMap);
  console.log(`✅ Workspace scan complete. Found ${results.length} unique algorithms.`);
  
  return results;
}