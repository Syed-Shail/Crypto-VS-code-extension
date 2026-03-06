// src/parser/index.ts
import * as vscode from 'vscode';
import { regexDetector } from './regex-detector';
import { detectMultiLang } from './multilang-detector';
import { CryptoAsset } from './types';
import * as path from 'path';
import { getParserForExtension, getParserForLanguageId } from './ts-wasm';

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

function dedupeAssets(assets: CryptoAsset[]): CryptoAsset[] {
  const merged = new Map<string, CryptoAsset>();

  for (const asset of assets) {
    const normalizedName = (asset.name || '').toLowerCase();
    const normalizedSource = asset.source || '';
    const key = `${normalizedName}:${normalizedSource}:${asset.line}:${asset.type || asset.primitive || 'unknown'}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...asset });
      continue;
    }

    existing.occurrences = (existing.occurrences || 0) + (asset.occurrences || 1);
    if (asset.detectionContexts?.length) {
      existing.detectionContexts = existing.detectionContexts || [];
      existing.detectionContexts.push(...asset.detectionContexts);
    }
  }

  return Array.from(merged.values());
}

async function detectLanguageAware(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const ext = path.extname(uri.fsPath).toLowerCase();
  const doc = await vscode.workspace.openTextDocument(uri);
  const languageId = doc.languageId;

  console.log(`🌐 Language detected: ${languageId} (${ext || 'no extension'})`);

  const astDetections: CryptoAsset[] = [];
  const parserInfoByLanguage = await getParserForLanguageId(languageId).catch(() => null);
  const parserInfoByExtension = await getParserForExtension(ext).catch(() => null);
  const parserInfo = parserInfoByLanguage || parserInfoByExtension;

  if (parserInfo) {
    console.log(`🧠 Using Tree-sitter parser: ${parserInfo.langKey}`);
    astDetections.push(...(await detectMultiLang(uri, parserInfo.langKey).catch(() => [])));
  } else {
    console.log(`ℹ️ No parser configured for ${ext || languageId}; using regex-based detection`);
  }

  // Regex detection still runs as a complementary detector for language-specific rules.
  const regexDetections = regexDetector.scan(doc.getText(), uri.fsPath);

  return dedupeAssets([...astDetections, ...regexDetections]);
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
      const assets = await detectLanguageAware(uri);
      
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
