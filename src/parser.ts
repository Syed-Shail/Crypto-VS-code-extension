import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

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
 * Regex-based Algorithm Database (for non-JS languages)
 * -------------------------------------------------------------------------- */
const algorithmDB: Record<string, any> = {
  MD5: { regex: /\bmd5\b/gi, type: 'Hash', quantumSafe: false, description: 'Obsolete hash function.' },
  SHA1: { regex: /\bsha-?1\b/gi, type: 'Hash', quantumSafe: false, description: 'Weak hash function.' },
  SHA256: { regex: /\bsha-?256\b/gi, type: 'Hash', quantumSafe: 'partial', description: 'SHA2 family hash.' },
  SHA512: { regex: /\bsha-?512\b/gi, type: 'Hash', quantumSafe: 'partial', description: 'SHA2 family hash.' },
  SHA3: { regex: /\bsha3\b/gi, type: 'Hash', quantumSafe: 'partial', description: 'SHA3 family hash.' },
  AES: { regex: /\baes(?:[-_]?(128|192|256))?\b/gi, type: 'Cipher', quantumSafe: 'partial', description: 'AES block cipher.' },
  RSA: { regex: /\brsa[-_]?(2048|4096)?\b/gi, type: 'Asymmetric', quantumSafe: false, description: 'Public-key crypto.' },
  ECDSA: { regex: /\becdsa\b/gi, type: 'Signature', quantumSafe: false, description: 'ECC signature.' },
  KYBER: { regex: /\bkyber\b/gi, type: 'Post-Quantum', quantumSafe: true, description: 'Post-quantum KEM.' },
  DILITHIUM: { regex: /\bdilithium\b/gi, type: 'Post-Quantum', quantumSafe: true, description: 'Post-quantum signature.' },
  FALCON: { regex: /\bfalcon\b/gi, type: 'Post-Quantum', quantumSafe: true, description: 'Post-quantum signature.' }
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
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  for (const off of offsets) {
    let lo = 0,
      hi = lineStarts.length - 1;
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
 * Quantum Safety Classification
 * -------------------------------------------------------------------------- */
function classifyQuantumSafety(name: string): boolean | 'partial' | 'unknown' {
  const lower = name.toLowerCase();
  if (lower.includes('rsa') || lower.includes('ecdsa') || lower.includes('sha1') || lower.includes('md5')) return false;
  if (lower.includes('aes') || lower.includes('sha2') || lower.includes('sha3') || lower.includes('sha256')) return 'partial';
  if (lower.includes('kyber') || lower.includes('dilithium') || lower.includes('falcon')) return true;
  return 'unknown';
}

/* --------------------------------------------------------------------------
 * AST-based Detector for JS/TS (robust, avoids type mismatches)
 * -------------------------------------------------------------------------- */
function detectInJsAst(text: string, filePath: string): CryptoAsset[] {
  const found: Record<string, CryptoAsset> = {};

  // parse into an AST (we will cast to any when traversing to avoid cross-package type mismatch)
  let parsedAst: any;
  try {
    parsedAst = parse(text, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      allowReturnOutsideFunction: true
    });
  } catch (err) {
    console.error(`AST parse error in ${filePath}:`, err);
    return [];
  }

  // traverse as any -> avoids TS type incompatibility between different @babel/types instances
  traverse(parsedAst as any, {
    CallExpression(path: any) {
      const node: any = path.node;

      // Only handle member expressions: object.method(...)
      if (!t.isMemberExpression(node.callee)) return;
      const obj = node.callee.object;
      const prop = node.callee.property;

      if (!t.isIdentifier(obj) || !t.isIdentifier(prop)) return;

      const objectName = obj.name;
      const methodName = prop.name;

      // Detect Node.js crypto API calls
      if (objectName === 'crypto' && ['createHash', 'createCipheriv', 'createDecipheriv', 'createHmac'].includes(methodName)) {
        let algorithm: string | undefined;

        if (node.arguments && node.arguments.length > 0) {
          const firstArg = node.arguments[0];

          // literal string argument
          if (t.isStringLiteral(firstArg)) {
            algorithm = firstArg.value;
          }
          // variable argument - try to resolve simple initializer (var/const)
          else if (t.isIdentifier(firstArg)) {
            const varName = firstArg.name;
            // path.scope.getBinding exists on Babel Path; check defensively
            const binding = typeof path.scope?.getBinding === 'function' ? path.scope.getBinding(varName) : undefined;
            if (binding && binding.path) {
              // binding.path may be any NodePath; check for variable declarator and initializer
              try {
                if (typeof binding.path.isVariableDeclarator === 'function' && binding.path.isVariableDeclarator()) {
                  const init = binding.path.node.init;
                  if (init && t.isStringLiteral(init)) {
                    algorithm = init.value;
                  }
                }
              } catch {
                // ignore binding inspection errors
              }
            }
          }
        }

        // If we found an algorithm string, record it
        if (algorithm) {
          const name = algorithm.toUpperCase();
          const line = node.loc?.start?.line ?? 0;
          const id = `js:${name}`;

          if (!found[id]) {
            found[id] = {
              id,
              assetType: 'algorithm',
              primitive: 'unknown',
              name,
              description: `Detected in ${objectName}.${methodName}()`,
              quantumSafe: classifyQuantumSafety(name),
              detectionContexts: [{ filePath, lineNumbers: [line], snippet: snippetAt(text, node.start ?? 0) }],
              occurrences: 1
            };
          } else {
            found[id].occurrences += 1;
            found[id].detectionContexts.push({ filePath, lineNumbers: [line], snippet: snippetAt(text, node.start ?? 0) });
          }
        }
      }
    }
  });

  return Object.values(found);
}

/* --------------------------------------------------------------------------
 * Unified Detector (AST + Regex)
 * -------------------------------------------------------------------------- */
export async function detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();

  // Use AST for JS/TS files
  if (uri.fsPath.endsWith('.js') || uri.fsPath.endsWith('.ts') || uri.fsPath.endsWith('.jsx') || uri.fsPath.endsWith('.tsx')) {
    return detectInJsAst(text, uri.fsPath);
  }

  // Fallback to regex detection for other languages
  const found: Record<string, CryptoAsset> = {};

  for (const [name, info] of Object.entries(algorithmDB)) {
    const regex = info.regex as RegExp;
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    const r = new RegExp(regex.source, flags);
    const offsets: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = r.exec(text)) !== null) {
      offsets.push(match.index);
      if (match[0].length === 0) r.lastIndex++;
    }

    if (offsets.length > 0) {
      const lines = offsetToLineNumbers(text, offsets);
      const contexts: DetectionContext[] = [
        { filePath: uri.fsPath, lineNumbers: lines, snippet: snippetAt(text, offsets[0]) }
      ];
      const id = makeId(name, info.variant);
      if (!found[id]) {
        found[id] = {
          id,
          assetType: 'algorithm',
          primitive: info.type || 'unknown',
          name,
          variant: info.variant,
          quantumSafe: info.quantumSafe,
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
  languageGlobs: string[] = ['**/*.{js,ts,py,java,cpp,c}'],
  excludeGlobs: string[] = ['**/node_modules/**', '**/.git/**', '**/venv/**'],
  onProgress?: (p: { processed: number; total?: number }) => void,
  token?: vscode.CancellationToken
): Promise<CryptoAsset[]> {
  const files = await Promise.all(languageGlobs.map(g => vscode.workspace.findFiles(g, `{${excludeGlobs.join(',')}}`)));
  const uris = Array.from(new Set(files.flat().map(u => u.fsPath))).map(fp => vscode.Uri.file(fp));
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
    } catch (err) {
      // ignore parse/read errors for individual files
    }
    processed++;
    onProgress?.({ processed, total });
  }

  return Object.values(aggregated);
}

/* --------------------------------------------------------------------------
 * Report Writer
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
      occurrences: a.occurrences,
      quantumSafe: a.quantumSafe,
      description: a.description,
      files: a.detectionContexts.map(c => ({ file: c.filePath, lines: c.lineNumbers }))
    }))
  };

  const outPath = path.join(workspaceFolder.uri.fsPath, 'cbom.json');
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
  return outPath;
}
