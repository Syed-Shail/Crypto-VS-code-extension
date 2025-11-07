// src/parser/regex-detector.ts

import * as vscode from 'vscode';
import { DetectorPlugin } from './detector-base';
import { CryptoAsset } from './types';
import * as fs from 'fs';

/* --------------------------------------------------------------------------
 * Algorithm Database
 * -------------------------------------------------------------------------- */
const algorithmDB: Record<string, {
  regex: RegExp;
  type: string;
  quantumSafe: boolean | 'partial' | 'unknown';
  description: string;
}> = {
  // Hashes
  MD5: { regex: /\bmd5\b/i, type: 'hash', quantumSafe: false, description: 'Obsolete hash function.' },
  SHA1: { regex: /\bsha[-_]?1\b/i, type: 'hash', quantumSafe: false, description: 'Weak hash function.' },
  SHA224: { regex: /\bsha[-_]?224\b/i, type: 'hash', quantumSafe: 'partial', description: 'SHA2 hash function.' },
  SHA256: { regex: /\bsha[-_]?256\b/i, type: 'hash', quantumSafe: 'partial', description: 'SHA2 hash function.' },
  SHA384: { regex: /\bsha[-_]?384\b/i, type: 'hash', quantumSafe: 'partial', description: 'SHA2 hash function.' },
  SHA512: { regex: /\bsha[-_]?512\b/i, type: 'hash', quantumSafe: 'partial', description: 'SHA2 hash function.' },
  SHA3: { regex: /\bsha3[-_]?(\d+)?\b/i, type: 'hash', quantumSafe: 'partial', description: 'SHA3 family hash function.' },

  // Symmetric
  AES: { regex: /\baes[-_]?(128|192|256)?\b/i, type: 'cipher', quantumSafe: 'partial', description: 'AES block cipher.' },
  DES: { regex: /\b3?des\b/i, type: 'cipher', quantumSafe: false, description: 'Outdated DES/3DES cipher.' },
  RC4: { regex: /\brc4\b/i, type: 'cipher', quantumSafe: false, description: 'Deprecated RC4 stream cipher.' },
  CHACHA20: { regex: /\bchacha20\b/i, type: 'cipher', quantumSafe: 'partial', description: 'Modern stream cipher.' },

  // Asymmetric
  RSA: { regex: /\brsa[-_]?(2048|4096)?\b/i, type: 'asymmetric', quantumSafe: false, description: 'Public-key algorithm vulnerable to quantum attacks.' },
  DSA: { regex: /\bdsa\b/i, type: 'asymmetric', quantumSafe: false, description: 'Digital Signature Algorithm.' },
  ECDSA: { regex: /\becdsa\b/i, type: 'asymmetric', quantumSafe: false, description: 'Elliptic Curve signature algorithm.' },
  ED25519: { regex: /\bed25519\b/i, type: 'asymmetric', quantumSafe: false, description: 'ECC signature algorithm.' },

  // PQC (Post-Quantum)
  KYBER: { regex: /\bkyber\b/i, type: 'post-quantum', quantumSafe: true, description: 'Post-quantum KEM (lattice-based).' },
  DILITHIUM: { regex: /\bdilithium\b/i, type: 'post-quantum', quantumSafe: true, description: 'Post-quantum signature scheme.' },
  FALCON: { regex: /\bfalcon\b/i, type: 'post-quantum', quantumSafe: true, description: 'Post-quantum signature (lattice-based).' },
  SPHINCS: { regex: /\bsphincs\+?\b/i, type: 'post-quantum', quantumSafe: true, description: 'Hash-based PQ signature.' },
};

/* --------------------------------------------------------------------------
 * Utility Helpers
 * -------------------------------------------------------------------------- */
function makeId(name: string): string {
  return `regex:${name.toLowerCase().replace(/\s+/g, '-')}`;
}

function offsetToLineNumbers(text: string, offsets: number[]): number[] {
  const lines: number[] = [];
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  for (const off of offsets) {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (lineStarts[mid] <= off) lo = mid + 1;
      else hi = mid - 1;
    }
    const lineIdx = Math.max(0, lo - 1);
    lines.push(lineIdx + 1);
  }
  return Array.from(new Set(lines)).sort((a, b) => a - b);
}

function snippetAt(text: string, index: number, radius = 80): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.substring(start, end).replace(/\r?\n/g, ' ');
}

/* --------------------------------------------------------------------------
 * Main Regex Detector
 * -------------------------------------------------------------------------- */
export const regexDetector: DetectorPlugin = {
  extensions: ['.py', '.java', '.cpp', '.c', '.go', '.rs', '.txt', '.cfg', '.conf', '.yml', '.yaml'],
  languageIds: ['python', 'java', 'cpp', 'c', 'plaintext', 'go', 'rust'],

  async detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
    console.log('🧩 [REGEX DETECTOR] Scanning file:', uri.fsPath);
    const text = fs.readFileSync(uri.fsPath, 'utf8');
    const found: Record<string, CryptoAsset> = {};

    for (const [name, info] of Object.entries(algorithmDB)) {
      const regex = new RegExp(info.regex.source, info.regex.flags.includes('g') ? info.regex.flags : info.regex.flags + 'g');
      const offsets: number[] = [];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        offsets.push(match.index);
        if (match[0].length === 0) regex.lastIndex++;
      }

      if (offsets.length > 0) {
        const lines = offsetToLineNumbers(text, offsets);
        const contexts = [
          { filePath: uri.fsPath, lineNumbers: lines, snippet: snippetAt(text, offsets[0]) }
        ];

        const id = makeId(name);
        found[id] = {
          id,
          assetType: 'algorithm',
          primitive: info.type,
          name,
          description: info.description,
          quantumSafe: info.quantumSafe,
          detectionContexts: contexts,
          occurrences: offsets.length,
        };

        console.log(`✅ [REGEX DETECTOR] Found ${name} (${info.type}) at lines: ${lines.join(', ')}`);
      }
    }

    console.log(`📦 [REGEX DETECTOR] Finished scanning ${uri.fsPath}. Found ${Object.keys(found).length} algorithms.`);
    return Object.values(found);
  }
};
