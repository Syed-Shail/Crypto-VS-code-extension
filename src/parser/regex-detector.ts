// src/parser/regex-detector.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import { DetectorPlugin } from './detector-base';
import { CryptoAsset } from './types';
import { assignRisk } from './risk-utils';

/**
 * Algorithm pattern database
 */
const algorithmDB: Record<string, {
  regex: RegExp;
  type: string;
  quantumSafe: boolean | 'partial' | 'unknown';
  description: string;
}> = {
  // Hashes
  MD5: { 
    regex: /\bmd5\b/i, 
    type: 'hash', 
    quantumSafe: false, 
    description: 'Cryptographically broken hash function' 
  },
  SHA1: { 
    regex: /\bsha[-_]?1\b/i, 
    type: 'hash', 
    quantumSafe: false, 
    description: 'Deprecated weak hash function' 
  },
  SHA224: { 
    regex: /\bsha[-_]?224\b/i, 
    type: 'hash', 
    quantumSafe: 'partial', 
    description: 'SHA-2 family hash' 
  },
  SHA256: { 
    regex: /\bsha[-_]?256\b/i, 
    type: 'hash', 
    quantumSafe: 'partial', 
    description: 'SHA-2 family hash (256-bit)' 
  },
  SHA384: { 
    regex: /\bsha[-_]?384\b/i, 
    type: 'hash', 
    quantumSafe: 'partial', 
    description: 'SHA-2 family hash (384-bit)' 
  },
  SHA512: { 
    regex: /\bsha[-_]?512\b/i, 
    type: 'hash', 
    quantumSafe: 'partial', 
    description: 'SHA-2 family hash (512-bit)' 
  },
  SHA3: { 
    regex: /\bsha3[-_]?(\d+)?\b/i, 
    type: 'hash', 
    quantumSafe: 'partial', 
    description: 'SHA-3 family hash function' 
  },
  BLAKE2: { 
    regex: /\bblake2[bs]?\b/i, 
    type: 'hash', 
    quantumSafe: 'partial', 
    description: 'Modern cryptographic hash' 
  },

  // Symmetric Ciphers
  AES: { 
    regex: /\baes[-_]?(128|192|256)?\b/i, 
    type: 'cipher', 
    quantumSafe: 'partial', 
    description: 'Advanced Encryption Standard' 
  },
  DES: { 
    regex: /\b3?des\b/i, 
    type: 'cipher', 
    quantumSafe: false, 
    description: 'Obsolete DES/3DES cipher' 
  },
  RC4: { 
    regex: /\brc4\b/i, 
    type: 'cipher', 
    quantumSafe: false, 
    description: 'Broken stream cipher' 
  },
  CHACHA20: { 
    regex: /\bchacha20\b/i, 
    type: 'cipher', 
    quantumSafe: 'partial', 
    description: 'Modern stream cipher' 
  },

  // Asymmetric / Public Key
  RSA: { 
    regex: /\brsa[-_]?(2048|4096|8192)?\b/i, 
    type: 'asymmetric', 
    quantumSafe: false, 
    description: 'Rivest-Shamir-Adleman public-key cryptosystem' 
  },
  DSA: { 
    regex: /\bdsa\b/i, 
    type: 'asymmetric', 
    quantumSafe: false, 
    description: 'Digital Signature Algorithm' 
  },
  ECDSA: { 
    regex: /\becdsa\b/i, 
    type: 'asymmetric', 
    quantumSafe: false, 
    description: 'Elliptic Curve Digital Signature Algorithm' 
  },
  ED25519: { 
    regex: /\bed25519\b/i, 
    type: 'asymmetric', 
    quantumSafe: false, 
    description: 'EdDSA signature scheme using Curve25519' 
  },
  ECDH: { 
    regex: /\becdh\b/i, 
    type: 'asymmetric', 
    quantumSafe: false, 
    description: 'Elliptic Curve Diffie-Hellman' 
  },

  // Post-Quantum Cryptography
  KYBER: { 
    regex: /\bkyber[-_]?(512|768|1024)?\b/i, 
    type: 'post-quantum', 
    quantumSafe: true, 
    description: 'NIST PQC lattice-based KEM' 
  },
  DILITHIUM: { 
    regex: /\bdilithium[-_]?[2-5]?\b/i, 
    type: 'post-quantum', 
    quantumSafe: true, 
    description: 'NIST PQC lattice-based signature' 
  },
  FALCON: { 
    regex: /\bfalcon[-_]?(512|1024)?\b/i, 
    type: 'post-quantum', 
    quantumSafe: true, 
    description: 'NIST PQC lattice-based signature' 
  },
  SPHINCS: { 
    regex: /\bsphincs\+?\b/i, 
    type: 'post-quantum', 
    quantumSafe: true, 
    description: 'Stateless hash-based signature' 
  },
};

/**
 * Utility functions
 */
function makeId(name: string): string {
  return `regex:${name.toLowerCase().replace(/\s+/g, '-')}`;
}

function offsetToLineNumbers(text: string, offsets: number[]): number[] {
  const lines: number[] = [];
  const lineStarts: number[] = [0];
  
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  
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

/**
 * Main regex-based detector
 */
export const regexDetector: DetectorPlugin = {
  extensions: [
    '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', 
    '.txt', '.cfg', '.conf', '.yml', '.yaml', '.json'
  ],
  languageIds: [
    'python', 'java', 'cpp', 'c', 'plaintext', 
    'go', 'rust', 'yaml', 'json'
  ],

  async detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
    console.log('🧩 [REGEX DETECTOR] Scanning:', uri.fsPath);
    
    if (!fs.existsSync(uri.fsPath)) {
      console.warn('⚠️ File not found');
      return [];
    }

    const text = fs.readFileSync(uri.fsPath, 'utf8');
    const found: Record<string, CryptoAsset> = {};

    for (const [name, info] of Object.entries(algorithmDB)) {
      const regex = new RegExp(
        info.regex.source,
        info.regex.flags.includes('g') ? info.regex.flags : info.regex.flags + 'g'
      );
      
      const offsets: number[] = [];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        offsets.push(match.index);
        if (match[0].length === 0) regex.lastIndex++;
      }

      if (offsets.length > 0) {
        const lines = offsetToLineNumbers(text, offsets);
        const id = makeId(name);
        
        // Assign risk using the risk engine
        const { severity, score } = assignRisk(info.quantumSafe, info.type, name);

        found[id] = {
          id,
          assetType: 'algorithm',
          primitive: info.type,
          name,
          description: info.description,
          quantumSafe: info.quantumSafe,
          detectionContexts: [{
            filePath: uri.fsPath,
            lineNumbers: lines,
            snippet: snippetAt(text, offsets[0])
          }],
          occurrences: offsets.length,
          severity,
          riskScore: score
        };

        console.log(`✅ Found: ${name} | Severity: ${severity} | Risk: ${score}`);
      }
    }

    console.log(`📦 Regex scan complete. Found ${Object.keys(found).length} algorithms.`);
    return Object.values(found);
  }
};