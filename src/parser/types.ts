// src/parser/types.ts
import * as vscode from 'vscode';

export type AssetType = 'algorithm' | 'library' | 'key' | 'certificate';

export interface DetectionContext {
  filePath: string;
  lineNumbers: number[];
  snippet?: string;
}

export interface CryptoAsset {
  id: string;
  assetType: AssetType;
  primitive: string;
  name: string;
  variant?: string;
  keySize?: number | string;
  quantumSafe?: boolean | 'partial' | 'unknown';
  description?: string;
  detectionContexts: DetectionContext[];
  occurrences: number;
}
