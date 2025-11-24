// src/parser/index.ts

import * as vscode from 'vscode';
import { CryptoAsset } from './types';
import { regexDetector } from './regex-detector';
import { detectMultiLang } from './multilang-detector';

/**
 * Merge results from regex and AST detectors.
 * Deduplicates by (name, primitive, assetType, filePath, line).
 */
function mergeResults(a: CryptoAsset[], b: CryptoAsset[]): CryptoAsset[] {
  const merged: CryptoAsset[] = [];
  const seen = new Set<string>();

  const all = [...a, ...b];

  for (const r of all) {
    const file = r.detectionContexts?.[0]?.filePath ?? '';
    const line = r.detectionContexts?.[0]?.lineNumbers?.[0] ?? 0;
    const key = `${r.name}|${r.primitive}|${r.assetType}|${file}|${line}`;

    if (!seen.has(key)) {
      seen.add(key);
      merged.push(r);
    }
  }

  return merged;
}

/**
 * Detect crypto in a single document.
 * - Always uses regexDetector
 * - Uses detectMultiLang (WASM AST) when possible
 */
export async function detectInDocument(
  uri: vscode.Uri
): Promise<CryptoAsset[]> {
  try {
    const [regexResults, astResults] = await Promise.all([
      regexDetector.detectInDocument(uri),
      detectMultiLang(uri).catch(err => {
        console.warn(
          '[MULTILANG-WASM] AST detection failed, using regex only:',
          err
        );
        return [];
      })
    ]);

    return mergeResults(regexResults, astResults);
  } catch (err) {
    console.error('[detectInDocument] Error:', err);
    return [];
  }
}

/**
 * Scan the entire workspace using regex + AST.
 */
export async function scanWorkspace(
  onProgress: (p: { processed: number; total?: number }) => void,
  token: vscode.CancellationToken
): Promise<CryptoAsset[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return [];
  }

  const patterns = [
    '**/*.py',
    '**/*.java',
    '**/*.c',
    '**/*.cpp',
    '**/*.go',
    '**/*.rs',
    '**/*.txt',
    '**/*.cfg',
    '**/*.conf',
    '**/*.yml',
    '**/*.yaml',
    '**/*.json'
  ];

  const exclude =
    '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**}';

  let files: vscode.Uri[] = [];

  for (const pattern of patterns) {
    if (token.isCancellationRequested) break;
    const uris = await vscode.workspace.findFiles(pattern, exclude);
    files.push(...uris);
  }

  // De-duplicate
  const seenPaths = new Set<string>();
  files = files.filter(u => {
    const key = u.fsPath.toLowerCase();
    if (seenPaths.has(key)) return false;
    seenPaths.add(key);
    return true;
  });

  const total = files.length;
  let processed = 0;
  let allResults: CryptoAsset[] = [];

  for (const uri of files) {
    if (token.isCancellationRequested) break;

    try {
      const [regexResults, astResults] = await Promise.all([
        regexDetector.detectInDocument(uri),
        detectMultiLang(uri).catch(err => {
          console.warn(
            '[MULTILANG-WASM] AST detection failed during workspace scan:',
            err
          );
          return [];
        })
      ]);

      const merged = mergeResults(regexResults, astResults);
      allResults = allResults.concat(merged);
    } catch (err) {
      console.error('[scanWorkspace] Error scanning file:', uri.fsPath, err);
    }

    processed++;
    onProgress({ processed, total });
  }

  return allResults;
}
