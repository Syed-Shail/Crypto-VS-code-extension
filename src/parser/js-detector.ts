import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as fs from 'fs';
import { CryptoAsset } from './types.js';
import { assignRisk } from './risk-utils.js';

/* --------------------------------------------------------------------------
 * 🔹 Helper Functions
 * -------------------------------------------------------------------------- */

/**
 * Create a unique, normalized ID for each detected crypto algorithm.
 */
function makeId(name: string): string {
  return `js:${name.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Returns a short snippet of text surrounding a detected node.
 */
function snippetAt(text: string, index: number, radius = 80): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.substring(start, end).replace(/\r?\n/g, ' ');
}

/**
 * Classify whether a crypto algorithm is quantum-safe, partially safe, or unsafe.
 */
function classifyQuantumSafety(name: string): boolean | 'partial' | 'unknown' {
  const lower = name.toLowerCase();

  if (lower.includes('rsa') || lower.includes('ecdsa') || lower.includes('sha1') || lower.includes('md5'))
    return false;
  if (
    lower.includes('aes') ||
    lower.includes('sha2') ||
    lower.includes('sha3') ||
    lower.includes('sha256') ||
    lower.includes('sha512')
  )
    return 'partial';
  if (
    lower.includes('kyber') ||
    lower.includes('dilithium') ||
    lower.includes('falcon') ||
    lower.includes('sphincs')
  )
    return true;

  return 'unknown';
}

/* --------------------------------------------------------------------------
 * 🔍 Main JavaScript / TypeScript Crypto Detector
 * -------------------------------------------------------------------------- */

export const jsDetector = {
  extensions: ['.js', '.jsx', '.ts', '.tsx'],
  languageIds: ['javascript', 'typescript'],

  async detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
    console.log('🔍 [JS DETECTOR] Starting detection for:', uri.fsPath);

    const filePath = uri.fsPath;
    const compilerOptions: ts.CompilerOptions = {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    };

    // Create a TypeScript program for analysis
    const program = ts.createProgram([filePath], compilerOptions);
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(filePath);

    if (!sourceFile) {
      console.warn('⚠️ [JS DETECTOR] No source file found for:', filePath);
      return [];
    }

    const fileText = fs.readFileSync(filePath, 'utf8');
    const found: Record<string, CryptoAsset> = {};

    /**
     * Recursively visit AST nodes.
     */
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expr = node.expression;

        if (ts.isPropertyAccessExpression(expr)) {
          const objName = expr.expression.getText(sourceFile);
          const methodName = expr.name.getText(sourceFile);

          // Detect use of Node.js crypto APIs
          if (
            objName === 'crypto' &&
            ['createHash', 'createHmac', 'createCipheriv', 'createDecipheriv'].includes(methodName)
          ) {
            let algorithm: string | undefined;
            const firstArg = node.arguments[0];

            if (firstArg) {
              if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
                algorithm = firstArg.text;
              } else if (ts.isIdentifier(firstArg)) {
                const sym = checker.getSymbolAtLocation(firstArg);
                if (sym && sym.valueDeclaration && ts.isVariableDeclaration(sym.valueDeclaration)) {
                  const init = sym.valueDeclaration.initializer;
                  if (init && ts.isStringLiteral(init)) {
                    algorithm = init.text;
                  }
                }
              }
            }

            if (algorithm) {
              const nameUp = algorithm.toUpperCase();
              const id = makeId(nameUp);
              const quantumSafe = classifyQuantumSafety(nameUp);
              const { severity, score } = assignRisk(quantumSafe, 'hash',nameUp);

              const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              const snippet = snippetAt(fileText, node.getStart(sourceFile));

              if (!found[id]) {
                found[id] = {
                  id,
                  assetType: 'algorithm',
                  primitive: 'hash',
                  name: nameUp,
                  description: `Detected in ${objName}.${methodName}()`,
                  quantumSafe,
                  detectionContexts: [
                    { filePath, lineNumbers: [pos.line + 1], snippet }
                  ],
                  occurrences: 1,
                  severity,
                  riskScore: score,
                };
              } else {
                found[id].occurrences += 1;
                found[id].detectionContexts.push({
                  filePath,
                  lineNumbers: [pos.line + 1],
                  snippet,
                });
              }

              console.log(
                `✅ [JS DETECTOR] Found algorithm: ${nameUp} | Severity: ${severity} | Risk Score: ${score}`
              );
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    console.log(`📦 [JS DETECTOR] Finished scanning ${filePath}. Found ${Object.keys(found).length} algorithms.`);
    return Object.values(found);
  },
};
