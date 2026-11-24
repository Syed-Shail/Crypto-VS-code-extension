// src/parser/detector-orchestrator.ts

import { CryptoAsset } from "./types";
import { analyzeSource } from "./analyze-source";
import * as fs from "fs";
import * as vscode from "vscode";

export class DetectorOrchestrator {
  /** Scans source with the shared syntax-aware engine and conservative text fallback. */
  async scanFile(content: string, filename: string): Promise<CryptoAsset[]> {
    return analyzeSource(content, filename);
  }
}

/**
 * Helper used by extension.ts (detectAll expects a Uri)
 */
export async function detectAll(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const content = fs.readFileSync(uri.fsPath, "utf8");
  const orch = new DetectorOrchestrator();
  return orch.scanFile(content, uri.fsPath);
}
