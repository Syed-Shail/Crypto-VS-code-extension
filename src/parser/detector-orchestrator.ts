// src/parser/detector-orchestrator.ts

import { CryptoAsset } from "./types";
import { regexDetector } from "./regex-detector";
import { detectMultiLang } from "./multilang-detector";
import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";

export class DetectorOrchestrator {
  /**
   * Scans a file using:
   *  - Regex detector (always)
   *  - WASM parser detector (when supported)
   */
  async scanFile(content: string, filename: string): Promise<CryptoAsset[]> {
    const regexHits = regexDetector.scan(content, filename);

    const fileUri = {
      fsPath: path.resolve(filename),
    } as any;

    const astHits = await detectMultiLang(fileUri).catch(() => []);

    return [...regexHits, ...astHits];
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
