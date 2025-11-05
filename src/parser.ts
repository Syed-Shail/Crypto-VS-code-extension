import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

/* --------------------------------------------------------------------------
 * Types
 * -------------------------------------------------------------------------- */
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

/* --------------------------------------------------------------------------
 * Algorithm Database (expanded to CBOMKit-level coverage)
 * -------------------------------------------------------------------------- */
const algorithmDB: Record<string, any> = {
  // --- Hash Functions ---
  MD5: {
    regex: /\bmd5\b/gi,
    type: 'Hash Function',
    keySize: '128-bit',
    securityLevel: 'Broken',
    quantumSafe: '❌ Not quantum-safe (classical collisions + Grover)',
    description: 'Obsolete hash function; avoid entirely.'
  },
  SHA1: {
    regex: /\bsha-?1\b/gi,
    type: 'Hash Function',
    keySize: '160-bit',
    securityLevel: 'Weak',
    quantumSafe: '❌ Not quantum-safe (Grover halves effective strength)',
    description: 'Deprecated hash with known collision vulnerabilities.'
  },
  SHA224: {
    regex: /\bsha-?224\b/gi,
    type: 'Hash Function',
    keySize: '224-bit',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe (Grover halves effective strength)',
    description: 'SHA-224 from SHA-2 family.'
  },
  SHA256: {
    regex: /\bsha-?256\b/gi,
    type: 'Hash Function',
    keySize: '256-bit',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe (Grover halves effective strength)',
    description: 'Secure hash widely used (SHA-2 family).'
  },
  SHA384: {
    regex: /\bsha-?384\b/gi,
    type: 'Hash Function',
    keySize: '384-bit',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe (Grover halves effective strength)',
    description: 'Strong hash (SHA-2 family).'
  },
  SHA512: {
    regex: /\bsha-?512\b/gi,
    type: 'Hash Function',
    keySize: '512-bit',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe (Grover halves effective strength)',
    description: '512-bit variant of SHA-2 family.'
  },
  SHA3: {
    regex: /\bsha3(?:-|_)?(224|256|384|512)?\b/gi,
    type: 'Hash Function',
    keySize: '224–512-bit',
    securityLevel: 'Very High',
    quantumSafe: '⚠️ Partially safe (Grover halves effective strength)',
    description: 'NIST SHA-3 (Keccak) hash family.'
  },
  BLAKE2: {
    regex: /\bblake2[bbs]?(\d+)?\b/gi,
    type: 'Hash Function',
    keySize: 'Variable',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe',
    description: 'Modern fast hash function alternative to SHA-2.'
  },
  // --- Symmetric Ciphers ---
  AES: {
    regex: /\baes(?:[-_]?(128|192|256))?\b/gi,
    type: 'Symmetric Cipher',
    keySize: '128/192/256-bit',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe (Grover halves key strength)',
    description: 'Industry-standard symmetric block cipher.'
  },
  DES: {
    regex: /\bdes\b/gi,
    type: 'Symmetric Cipher',
    keySize: '56-bit',
    securityLevel: 'Broken',
    quantumSafe: '❌ Not quantum-safe',
    description: 'Outdated cipher vulnerable to brute force.'
  },
  '3DES': {
    regex: /\b3des|triple[-_]?des\b/gi,
    type: 'Symmetric Cipher',
    keySize: '168-bit',
    securityLevel: 'Weak',
    quantumSafe: '❌ Not quantum-safe',
    description: 'Legacy cipher, partially deprecated.'
  },
  CHACHA20: {
    regex: /\bchacha(20)?\b/gi,
    type: 'Stream Cipher',
    keySize: '256-bit',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe',
    description: 'Modern stream cipher, often paired with Poly1305.'
  },
  RC4: {
    regex: /\brc4\b/gi,
    type: 'Stream Cipher',
    keySize: 'Variable',
    securityLevel: 'Broken',
    quantumSafe: '❌ Not quantum-safe',
    description: 'Obsolete stream cipher; insecure.'
  },
  // --- MACs & Authentication ---
  HMAC: {
    regex: /\bhmac[-_]?sha?(1|2|3)?\b/gi,
    type: 'MAC Function',
    keySize: 'Variable',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe',
    description: 'Hash-based message authentication code.'
  },
  CMAC: {
    regex: /\bcmac\b/gi,
    type: 'MAC Function',
    keySize: 'Variable',
    securityLevel: 'High',
    quantumSafe: '⚠️ Partially safe',
    description: 'Cipher-based MAC (e.g., AES-CMAC).'
  },
  // --- Asymmetric ---
  RSA: {
    regex: /\brsa[-_]?(2048|4096)?\b/gi,
    type: 'Asymmetric Cipher',
    keySize: '2048–4096-bit',
    securityLevel: 'Medium',
    quantumSafe: '❌ Not quantum-safe (Shor’s algorithm)',
    description: 'Public-key encryption/signature algorithm.'
  },
  DSA: {
    regex: /\bdsa\b/gi,
    type: 'Asymmetric Cipher',
    keySize: '1024–3072-bit',
    securityLevel: 'Medium',
    quantumSafe: '❌ Not quantum-safe',
    description: 'Digital Signature Algorithm.'
  },
  ECDSA: {
    regex: /\becdsa\b/gi,
    type: 'Asymmetric Cipher',
    keySize: '256–521-bit',
    securityLevel: 'High',
    quantumSafe: '❌ Not quantum-safe',
    description: 'Elliptic Curve Digital Signature Algorithm.'
  },
  ED25519: {
    regex: /\bed25519\b/gi,
    type: 'Asymmetric Cipher',
    keySize: '255-bit',
    securityLevel: 'High',
    quantumSafe: '❌ Not quantum-safe',
    description: 'Fast ECC-based digital signature algorithm.'
  },
  ECDH: {
    regex: /\becdh\b/gi,
    type: 'Key Exchange',
    keySize: '256-bit',
    securityLevel: 'High',
    quantumSafe: '❌ Not quantum-safe',
    description: 'Elliptic Curve Diffie-Hellman key exchange.'
  },
  DH: {
    regex: /\bdiffie[-_]?hellman\b|\bdh\b/gi,
    type: 'Key Exchange',
    keySize: '1024–4096-bit',
    securityLevel: 'Medium',
    quantumSafe: '❌ Not quantum-safe',
    description: 'Classical key exchange, vulnerable to quantum attack.'
  },
  // --- Post-Quantum Algorithms ---
  KYBER: {
    regex: /\bkyber\b/gi,
    type: 'Post-Quantum Cipher',
    keySize: 'Variable',
    securityLevel: 'Very High',
    quantumSafe: '✅ Quantum-safe (NIST PQC finalist)',
    description: 'Post-quantum key encapsulation mechanism.'
  },
  DILITHIUM: {
    regex: /\bdilithium\b/gi,
    type: 'Post-Quantum Signature',
    keySize: 'Variable',
    securityLevel: 'Very High',
    quantumSafe: '✅ Quantum-safe (NIST PQC finalist)',
    description: 'Post-quantum digital signature algorithm.'
  },
  FALCON: {
    regex: /\bfalcon\b/gi,
    type: 'Post-Quantum Signature',
    keySize: 'Variable',
    securityLevel: 'Very High',
    quantumSafe: '✅ Quantum-safe',
    description: 'Lattice-based post-quantum signature algorithm.'
  },
  SPHINCS: {
    regex: /\bsphincs\b/gi,
    type: 'Post-Quantum Signature',
    keySize: 'Variable',
    securityLevel: 'Very High',
    quantumSafe: '✅ Quantum-safe',
    description: 'Stateless hash-based post-quantum signature.'
  }
};

/* --------------------------------------------------------------------------
 * Helpers
 * -------------------------------------------------------------------------- */
function makeId(name: string, variant?: string) {
  const safe = name.toLowerCase().replace(/\s+/g, '-');
  return variant ? `${safe}:${variant.toLowerCase().replace(/\s+/g, '-')}` : safe;
}

function offsetToLineNumbers(text: string, offsets: number[]): number[] {
  const lines: number[] = [];
  if (offsets.length === 0) return lines;
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

function snippetAt(text: string, index: number, radius = 80) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.substring(start, end).replace(/\r?\n/g, ' ');
}

/* --------------------------------------------------------------------------
 * Core Detection
 * -------------------------------------------------------------------------- */
export async function detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  const found: Record<string, CryptoAsset> = {};

  for (const [name, info] of Object.entries(algorithmDB)) {
    const regex: RegExp = info.regex;
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    const r = new RegExp(regex.source, flags);

    let match: RegExpExecArray | null;
    const offsets: number[] = [];
    while ((match = r.exec(text)) !== null) {
      offsets.push(match.index);
      if (match[0].length === 0) r.lastIndex++;
    }

    if (offsets.length > 0) {
      const lines = offsetToLineNumbers(text, offsets);
      const contexts: DetectionContext[] = [
        {
          filePath: uri.fsPath,
          lineNumbers: lines,
          snippet: snippetAt(text, offsets[0])
        }
      ];

      const primitive = info.primitive ?? info.type ?? 'unknown';
      const rawQS = info.quantumSafe ?? 'unknown';
      let quantumSafe: boolean | 'partial' | 'unknown' = 'unknown';
      if (typeof rawQS === 'string') {
        if (rawQS.includes('✅')) quantumSafe = true;
        else if (rawQS.includes('⚠')) quantumSafe = 'partial';
        else if (rawQS.includes('❌')) quantumSafe = false;
      }

      const id = makeId(name, info.variant);
      if (!found[id]) {
        found[id] = {
          id,
          assetType: 'algorithm',
          primitive,
          name,
          variant: info.variant,
          keySize: info.keySize,
          quantumSafe,
          description: info.description,
          detectionContexts: contexts,
          occurrences: offsets.length
        };
      } else {
        found[id].occurrences += offsets.length;
        found[id].detectionContexts.push(...contexts);
      }
    }
  }
  return Object.values(found);
}

/* --------------------------------------------------------------------------
 * Workspace Scanner
 * -------------------------------------------------------------------------- */
export async function scanWorkspace(
  languageGlobs: string[] = ['**/*.{js,ts,py,java,go,rs,cpp,c,h}'],
  excludeGlobs: string[] = ['**/node_modules/**', '**/.git/**', '**/venv/**'],
  onProgress?: (p: { processed: number; total?: number }) => void,
  token?: vscode.CancellationToken
): Promise<CryptoAsset[]> {
  const files = await Promise.all(
    languageGlobs.map(g => vscode.workspace.findFiles(g, `{${excludeGlobs.join(',')}}`))
  );
  const uris = files.flat();
  const total = uris.length;
  const aggregated: Record<string, CryptoAsset> = {};
  let processed = 0;

  for (const uri of uris) {
    if (token?.isCancellationRequested) break;
    try {
      const assets = await detectInDocument(uri);
      for (const a of assets) {
        if (!aggregated[a.id]) aggregated[a.id] = { ...a };
        else {
          aggregated[a.id].occurrences += a.occurrences;
          aggregated[a.id].detectionContexts.push(...a.detectionContexts);
        }
      }
    } catch { /* skip unreadable files */ }
    processed++;
    onProgress?.({ processed, total });
  }
  return Object.values(aggregated);
}

/* --------------------------------------------------------------------------
 * Simple CBOM Writer (summary only, not full CBOM format)
 * -------------------------------------------------------------------------- */
export async function writeCbomJson(assets: CryptoAsset[], workspaceFolder?: vscode.WorkspaceFolder) {
  if (!workspaceFolder) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) throw new Error('No workspace folder open');
    workspaceFolder = folders[0];
  }
  const report = {
    generatedAt: new Date().toISOString(),
    generator: 'crypto-detector-vscode',
    detected: assets.map(a => ({
      algorithm: a.name,
      primitive: a.primitive,
      occurrences: a.occurrences,
      quantumSafe: a.quantumSafe,
      description: a.description,
      files: a.detectionContexts.map(c => ({
        file: c.filePath,
        lines: c.lineNumbers
      }))
    }))
  };
  const outPath = path.join(workspaceFolder.uri.fsPath, 'cbom.json');
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
  return outPath;
}
