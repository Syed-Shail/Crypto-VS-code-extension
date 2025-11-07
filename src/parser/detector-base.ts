// src/parser/detector-base.ts
import * as vscode from 'vscode';
import { CryptoAsset } from './types';

export interface DetectorPlugin {
  // extensions this plugin handles, e.g. ['.js', '.ts']
  extensions?: string[];
  // language IDs this plugin handles, e.g. ['javascript', 'typescript']
  languageIds?: string[];
  detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]>;
  // optional bulk scan
  detectFiles?(uris: vscode.Uri[], onProgress?: (p: { processed: number; total?: number }) => void): Promise<CryptoAsset[]>;
}
