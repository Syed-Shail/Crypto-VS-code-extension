// src/parser/detector-base.ts
import * as vscode from 'vscode';
import { CryptoAsset } from './types';

/**
 * Base interface that all detector plugins must implement
 */
export interface DetectorPlugin {
  /**
   * File extensions this detector handles (e.g., ['.js', '.ts'])
   */
  extensions?: string[];
  
  /**
   * VS Code language IDs this detector handles (e.g., ['javascript', 'typescript'])
   */
  languageIds?: string[];
  
  /**
   * Detect crypto algorithms in a document
   * @param uri The document URI to scan
   * @returns Array of detected crypto assets
   */
  detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]>;
  
  /**
   * Optional: Scan raw text content
   * @param content The text content to scan
   * @param filename The filename for context
   * @returns Array of detected crypto assets
   */
  scan?(content: string, filename: string): CryptoAsset[];
}