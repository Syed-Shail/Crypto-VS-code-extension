// src/parser/index.ts
import * as vscode from 'vscode';
import { jsDetector } from './js-detector';
import { regexDetector } from './regex-detector';
import { CryptoAsset } from './types';
import * as path from 'path';

// Import DetectorPlugin type
import type { DetectorPlugin } from './detector-base';

// Unified plugin registry
const plugins: DetectorPlugin[] = [
  jsDetector,
  regexDetector
];

/**
 * File extensions that should NOT be scanned (data files, configs, etc.)
 */
const EXCLUDED_EXTENSIONS = [
  '.json',    // JSON files (including CBOM reports)
  '.xml',     // XML files
  '.md',      // Markdown
  '.txt',     // Plain text docs
  '.pdf',     // PDFs
  '.png', '.jpg', '.gif', '.svg',  // Images
  '.zip', '.tar', '.gz',           // Archives
  '.lock',    // Lock files
  '.log',     // Log files
];

/**
 * Check if file should be skipped
 */
function shouldSkipFile(uri: vscode.Uri): boolean {
  const ext = path.extname(uri.fsPath).toLowerCase();
  const filename = path.basename(uri.fsPath).toLowerCase();
  
  // Skip excluded extensions
  if (EXCLUDED_EXTENSIONS.includes(ext)) {
    console.log(`⏩ Skipping ${filename} (excluded extension: ${ext})`);
    return true;
  }
  
  // Skip CBOM files specifically
  if (filename.includes('cbom') && ext === '.json') {
    console.log(`⏩ Skipping ${filename} (CBOM report file)`);
    return true;
  }
  
  // Skip package-lock, yarn.lock, etc.
  if (filename.includes('lock')) {
    console.log(`⏩ Skipping ${filename} (lock file)`);
    return true;
  }
  
  return false;
}

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
  console.log(`\n📄 Scanning file: ${uri.fsPath}`);
  
  // Check if file should be skipped
  if (shouldSkipFile(uri)) {
    return [];
  }
  
  const detector = getDetectorForUri(uri);
  const detectorName = detector === jsDetector ? 'JS/TS AST' : 'Regex';
  console.log(`🔍 Using ${detectorName} detector for ${path.basename(uri.fsPath)}`);
  
  try {
    const results = await detector.detectInDocument(uri);
    
    if (results.length > 0) {
      console.log(`✅ Found ${results.length} algorithm(s):`);
      results.forEach(r => {
        console.log(`   - ${r.name} (${r.primitive || r.type}) [${r.severity}]`);
      });
    } else {
      console.log(`ℹ️  No algorithms detected`);
    }
    
    return results;
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`❌ Error detecting in ${uri.fsPath}:`, error);
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
  
  console.log('\n📦 Starting workspace scan...');
  
  // Find all relevant files (exclude data files)
  const files = await vscode.workspace.findFiles(
    '**/*.{js,jsx,ts,tsx,py,java,cpp,c,h,rs,go,cs,php,rb,swift}',
    '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/target/**}'
  );
  
  console.log(`📁 Found ${files.length} source files to scan`);
  
  const total = files.length;
  const assetMap: Record<string, CryptoAsset> = {};
  let processed = 0;

  for (const uri of files) {
    if (token?.isCancellationRequested) {
      console.log('⚠️ Scan cancelled by user');
      break;
    }

    // Skip files that shouldn't be scanned
    if (shouldSkipFile(uri)) {
      processed++;
      onProgress?.({ processed, total });
      continue;
    }

    try {
      const detector = getDetectorForUri(uri);
      const assets = await detector.detectInDocument(uri);
      
      // Merge results by ID
      for (const asset of assets) {
        const assetId = asset.id || `unknown-${Date.now()}-${Math.random()}`;
        
        if (!assetMap[assetId]) {
          assetMap[assetId] = { ...asset, id: assetId };
        } else {
          // Merge occurrences and contexts
          const existing = assetMap[assetId];
          existing.occurrences = (existing.occurrences || 0) + (asset.occurrences || 1);
          existing.detectionContexts = existing.detectionContexts || [];
          existing.detectionContexts.push(...(asset.detectionContexts || []));
        }
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.warn(`⚠️ Failed to scan ${uri.fsPath}:`, error.message);
    }

    processed++;
    onProgress?.({ processed, total });
  }

  const results = Object.values(assetMap);
  console.log(`\n✅ Workspace scan complete. Found ${results.length} unique algorithms.`);
  
  return results;
}