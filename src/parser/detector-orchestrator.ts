// src/parser/detector-orchestrator.ts

import { CryptoAsset } from "./types";
import { regexDetector } from "./regex-detector";
import { detectMultiLang } from "./multilang-detector";
import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";

export class DetectorOrchestrator {
  private mergeAndDedupeDetections(regexHits: CryptoAsset[], astHits: CryptoAsset[]): CryptoAsset[] {
    const merged = new Map<string, CryptoAsset>();

    const add = (asset: CryptoAsset, sourceTag: "regex" | "ast") => {
      const file = asset.source ?? "unknown";
      const line = asset.line ?? -1;
      const key = `${asset.name.toLowerCase()}::${file}::${line}`;
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, { ...asset });
        return;
      }

      // Prefer AST metadata when the same detection appears in both engines.
      const preferred = sourceTag === "ast" ? asset : existing;
      const fallback = sourceTag === "ast" ? existing : asset;

      merged.set(key, {
        ...fallback,
        ...preferred,
        occurrences: Math.max(existing.occurrences ?? 1, asset.occurrences ?? 1),
        detectionContexts: [
          ...(existing.detectionContexts ?? []),
          ...(asset.detectionContexts ?? [])
        ]
      });
    };

    regexHits.forEach((hit) => add(hit, "regex"));
    astHits.forEach((hit) => add(hit, "ast"));

    return Array.from(merged.values());
  }

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

    return this.mergeAndDedupeDetections(regexHits, astHits);
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
