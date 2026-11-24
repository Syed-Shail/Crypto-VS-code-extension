import * as path from 'path';
import { CryptoAsset } from './types';
import { regexDetector } from './regex-detector';
import { detectMultiLang } from './multilang-detector';

/** Shared file analysis entry point for VS Code, repository scans, and the CLI. */
export async function analyzeSource(content: string, filename: string): Promise<CryptoAsset[]> {
  const syntaxFindings = await detectMultiLang(content, filename).catch(() => []);
  const textCandidates = regexDetector.scan(content, filename);
  const merged = new Map<string, CryptoAsset>();
  const confidenceRank = { unknown: 0, low: 1, medium: 2, high: 3 };

  for (const asset of [...syntaxFindings, ...textCandidates]) {
    const baseKey = [
      (asset.name || 'unknown').toLowerCase(),
      path.resolve(asset.source || filename),
      asset.line ?? 0,
      (asset.primitive || asset.type || 'unknown').toLowerCase()
    ].join('::');
    let key = `${baseKey}::${asset.startOffset ?? asset.column ?? 0}`;
    let existing = merged.get(key);

    if (!existing && asset.startOffset !== undefined && asset.endOffset !== undefined) {
      for (const [candidateKey, candidate] of merged) {
        if (!candidateKey.startsWith(`${baseKey}::`) || candidate.startOffset === undefined || candidate.endOffset === undefined) continue;
        const rangesOverlap = asset.startOffset <= candidate.endOffset && asset.endOffset >= candidate.startOffset;
        if (rangesOverlap) {
          key = candidateKey;
          existing = candidate;
          break;
        }
      }
    }

    if (!existing) {
      merged.set(key, {
        ...asset,
        severity: asset.confidence === 'high' ? asset.severity : 'unknown',
        detectionContexts: [...(asset.detectionContexts ?? [])]
      });
      continue;
    }

    existing.occurrences = Math.max(existing.occurrences ?? 1, asset.occurrences ?? 1);
    if (confidenceRank[asset.confidence ?? 'unknown'] > confidenceRank[existing.confidence ?? 'unknown']) {
      existing.confidence = asset.confidence;
      existing.detectionMethod = asset.detectionMethod;
      existing.reason = asset.reason;
      existing.severity = asset.severity;
      existing.quantumSafe = asset.quantumSafe;
      existing.quantumImpact = asset.quantumImpact;
      existing.classicalSecurityStatus = asset.classicalSecurityStatus;
      existing.severity = asset.confidence === 'high' ? asset.severity : 'unknown';
      existing.detectionContexts = [...(asset.detectionContexts ?? [])];
    } else if (confidenceRank[asset.confidence ?? 'unknown'] === confidenceRank[existing.confidence ?? 'unknown']) {
      existing.detectionContexts = [...(existing.detectionContexts ?? []), ...(asset.detectionContexts ?? [])];
    }
  }

  return Array.from(merged.values()).sort((a, b) =>
    (a.line ?? 0) - (b.line ?? 0) || a.name.localeCompare(b.name)
  );
}
