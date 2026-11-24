// src/parser/index.ts
import * as vscode from 'vscode';
import { CryptoAsset } from './types';
import * as path from 'path';
import { analyzeSource } from './analyze-source';
import * as fs from 'fs';
import { ScanCache, analysisVersion } from '../core/scan-cache';

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

async function detectLanguageAware(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const doc = await vscode.workspace.openTextDocument(uri);
  console.log(`🌐 Analyzing ${doc.languageId} source (${path.extname(uri.fsPath) || 'no extension'})`);
  return analyzeSource(doc.getText(), uri.fsPath);
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
  
  try {
    const results = await detectLanguageAware(uri);
    
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
let cacheDirectory: string | undefined;

/** Where workspace scan results are cached (the extension passes its global storage folder). */
export function setCacheDirectory(dir: string | undefined): void {
  cacheDirectory = dir;
}

async function analyseWithCache(uri: vscode.Uri, cache: ScanCache | undefined): Promise<CryptoAsset[]> {
  const open = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === uri.fsPath);
  if (!cache || open?.isDirty) {
    return detectLanguageAware(uri); // unsaved editor changes differ from disk, so never use the cache for them
  }
  const stat = await fs.promises.stat(uri.fsPath);
  const byStat = cache.byStat(uri.fsPath, stat);
  if (byStat) return byStat;
  const content = await fs.promises.readFile(uri.fsPath, 'utf8');
  const hash = ScanCache.hash(content);
  const byHash = cache.byHash(uri.fsPath, hash, stat);
  if (byHash) return byHash;
  const assets = await analyzeSource(content, uri.fsPath);
  cache.store(uri.fsPath, stat, hash, assets);
  return assets;
}

export async function scanWorkspace(
  onProgress?: (p: { processed: number; total?: number }) => void,
  token?: vscode.CancellationToken
): Promise<CryptoAsset[]> {
  
  console.log('\n📦 Starting workspace scan...');
  
  // Find all relevant files (exclude data files)
  const files = await vscode.workspace.findFiles(
    '**/*.{js,jsx,mjs,ts,tsx,py,java,kt,kts,c,cc,cpp,cxx,h,hpp,rs,go,cs,php,rb,swift}',
    '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/target/**}'
  );
  
  console.log(`📁 Found ${files.length} source files to scan`);
  
  const total = files.length;
  const assetMap: Record<string, CryptoAsset> = {};
  let processed = 0;
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cache = root && cacheDirectory
    ? await ScanCache.open(ScanCache.defaultPath(root, cacheDirectory), analysisVersion())
    : undefined;

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
      const assets = await analyseWithCache(uri, cache);
      
      // Merge results by ID
      for (const asset of assets) {
        const assetId = [
          (asset.name || 'unknown').toLowerCase(),
          path.resolve(asset.source || uri.fsPath),
          asset.line ?? 0,
          (asset.primitive || asset.type || 'unknown').toLowerCase()
        ].join('::');
        
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

  if (cache && !token?.isCancellationRequested) {
    cache.retainOnly(files.map(uri => uri.fsPath));
    await cache.save();
  }

  const results = Object.values(assetMap);
  console.log(`\n✅ Workspace scan complete. Found ${results.length} unique algorithms` +
    (cache ? ` (${cache.hits} files reused from cache, ${cache.misses} analysed).` : '.'));
  
  return results;
}
