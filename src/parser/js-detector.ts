// src/parser/js-detector.ts
import * as vscode from 'vscode';
import { CryptoAsset, Severity } from './types';
import { assignRisk } from './risk-utils';
import * as fs from 'fs';

/**
 * JavaScript-specific detector for crypto APIs
 * Detects Node.js crypto module usage and browser crypto APIs
 */
export class JSDetector {
  private readonly jsPatterns = [
    // Node.js crypto module
    { name: 'crypto.createHash', type: 'hash', quantumSafe: 'partial' as const },
    { name: 'crypto.createHmac', type: 'mac', quantumSafe: 'partial' as const },
    { name: 'crypto.createCipheriv', type: 'symmetric', quantumSafe: 'partial' as const },
    { name: 'crypto.createDecipheriv', type: 'symmetric', quantumSafe: 'partial' as const },
    { name: 'crypto.generateKeyPair', type: 'asymmetric', quantumSafe: false },
    { name: 'crypto.publicEncrypt', type: 'asymmetric', quantumSafe: false },
    { name: 'crypto.privateDecrypt', type: 'asymmetric', quantumSafe: false },
    
    // Web Crypto API
    { name: 'crypto.subtle.digest', type: 'hash', quantumSafe: 'partial' as const },
    { name: 'crypto.subtle.encrypt', type: 'symmetric', quantumSafe: 'partial' as const },
    { name: 'crypto.subtle.decrypt', type: 'symmetric', quantumSafe: 'partial' as const },
    { name: 'crypto.subtle.sign', type: 'asymmetric', quantumSafe: false },
    { name: 'crypto.subtle.verify', type: 'asymmetric', quantumSafe: false },
    
    // Specific algorithm mentions
    { name: 'SHA-256', type: 'hash', quantumSafe: 'partial' as const },
    { name: 'SHA-512', type: 'hash', quantumSafe: 'partial' as const },
    { name: 'MD5', type: 'hash', quantumSafe: false },
    { name: 'SHA-1', type: 'hash', quantumSafe: false },
    { name: 'AES', type: 'symmetric', quantumSafe: 'partial' as const },
    { name: 'RSA', type: 'asymmetric', quantumSafe: false },
    { name: 'ECDSA', type: 'asymmetric', quantumSafe: false },
  ];

  async detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
    try {
      const content = fs.readFileSync(uri.fsPath, 'utf8');
      return this.scan(content, uri.fsPath);
    } catch (err) {
      console.error(`[JSDetector] Failed to read file ${uri.fsPath}:`, err);
      return [];
    }
  }

  scan(content: string, filename: string): CryptoAsset[] {
    const results: CryptoAsset[] = [];
    const lines = content.split('\n');
    const seenDetections = new Set<string>();

    for (const pattern of this.jsPatterns) {
      const regex = new RegExp(this.escapeRegex(pattern.name), 'gi');

      lines.forEach((line, index) => {
        const matches = line.match(regex);
        if (matches) {
          const lineNumber = index + 1;
          const snippet = line.trim();
          
          // Avoid duplicates
          const detectionKey = `${pattern.name}-${filename}-${lineNumber}`;
          if (seenDetections.has(detectionKey)) {
            return;
          }
          seenDetections.add(detectionKey);

          const risk = assignRisk(pattern.quantumSafe, pattern.type, pattern.name);

          results.push({
            name: pattern.name,
            type: pattern.type,
            primitive: pattern.type,
            assetType: 'algorithm',
            description: `JavaScript crypto API: ${pattern.name}`,
            quantumSafe: pattern.quantumSafe,
            severity: risk.severity as Severity,
            score: risk.score,
            riskScore: risk.score,
            reason: risk.explanation,
            source: filename,
            line: lineNumber,
            occurrences: 1,
            id: `js:${pattern.name.toLowerCase()}-${lineNumber}`,
            detectionContexts: [
              {
                filePath: filename,
                lineNumbers: [lineNumber],
                snippet
              }
            ]
          });
        }
      });
    }

    return results;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export const jsDetector = new JSDetector();