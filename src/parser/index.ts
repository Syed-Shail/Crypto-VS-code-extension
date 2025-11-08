// src/parser/index.ts
import * as vscode from 'vscode';
import { DetectorPlugin } from './detector-base';
import { jsDetector } from './js-detector.js';
import { regexDetector } from './regex-detector';
import { CryptoAsset } from './types';

const plugins: DetectorPlugin[] = [
  jsDetector,
  regexDetector
];

function pluginForUri(uri: vscode.Uri): DetectorPlugin | undefined {
  const ext = (uri.fsPath.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  // prefer exact extension plugin
  for (const p of plugins) {
    if (p.extensions && p.extensions.includes(ext)) return p;
  }
  // fallback by language id
  try {
    const doc = vscode.workspace.openTextDocument(uri);
    // note: openTextDocument returns Promise — don't await here; callers will call detectInDocument which is async
  } catch {}
  // fallback to regex detector
  return regexDetector;
}

export async function detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const plugin = pluginForUri(uri) || regexDetector;
  return plugin.detectInDocument(uri);
}

export async function scanWorkspace(onProgress?: (p: { processed: number; total?: number }) => void, token?: vscode.CancellationToken): Promise<CryptoAsset[]> {
  const files = await vscode.workspace.findFiles('**/*.{js,jsx,ts,tsx,py,java,cpp,c,rs,go}', '**/node_modules/**');
  const total = files.length;
  const aggregated: Record<string, CryptoAsset> = {};
  let processed = 0;

  for (const uri of files) {
    if (token?.isCancellationRequested) break;
    try {
      const plugin = pluginForUri(uri) || regexDetector;
      const assets = await plugin.detectInDocument(uri);
      for (const a of assets) {
        if (!aggregated[a.id]) aggregated[a.id] = { ...a };
        else {
          aggregated[a.id].occurrences += a.occurrences;
          aggregated[a.id].detectionContexts.push(...a.detectionContexts);
        }
      }
    } catch (err) {
      // ignore file errors
    }
    processed++;
    onProgress?.({ processed, total });
  }

  return Object.values(aggregated);
}
