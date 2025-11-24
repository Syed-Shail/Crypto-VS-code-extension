// src/parser/js-detector.ts
import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as fs from 'fs';
import { CryptoAsset } from './types';
import { assignRisk } from './risk-utils';

/**
 * Create unique ID for detected algorithm
 */
function makeId(name: string): string {
  return `js:${name.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Extract snippet around detection point
 */
function snippetAt(text: string, index: number, radius = 80): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.substring(start, end).replace(/\r?\n/g, ' ');
}

/**
 * Classify quantum safety of algorithm
 */
function classifyQuantumSafety(name: string): boolean | 'partial' | 'unknown' {
  const lower = name.toLowerCase();

  // Known vulnerable algorithms
  if (lower.includes('rsa') || lower.includes('ecdsa') || 
      lower.includes('sha1') || lower.includes('md5') || 
      lower.includes('des') || lower.includes('rc4')) {
    return false;
  }

  // Partially quantum-resistant
  if (lower.includes('aes') || lower.includes('sha2') || 
      lower.includes('sha3') || lower.includes('sha256') || 
      lower.includes('sha512') || lower.includes('chacha')) {
    return 'partial';
  }

  // Post-quantum safe
  if (lower.includes('kyber') || lower.includes('dilithium') || 
      lower.includes('falcon') || lower.includes('sphincs')) {
    return true;
  }

  return 'unknown';
}

/**
 * Main JavaScript/TypeScript detector
 */
export const jsDetector = {
  extensions: ['.js', '.jsx', '.ts', '.tsx'],
  languageIds: ['javascript', 'typescript'],

  async detectInDocument(uri: vscode.Uri): Promise<CryptoAsset[]> {
    console.log('🔍 [JS DETECTOR] Scanning:', uri.fsPath);

    const filePath = uri.fsPath;
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.warn('⚠️ File not found:', filePath);
      return [];
    }

    const compilerOptions: ts.CompilerOptions = {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    };

    // Create TypeScript program
    const program = ts.createProgram([filePath], compilerOptions);
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(filePath);

    if (!sourceFile) {
      console.warn('⚠️ No source file found');
      return [];
    }

    const fileText = fs.readFileSync(filePath, 'utf8');
    const found: Record<string, CryptoAsset> = {};

    /**
     * Visit AST nodes recursively
     */
    const visit = (node: ts.Node): void => {
      // Detect crypto API calls
      if (ts.isCallExpression(node)) {
        const expr = node.expression;

        if (ts.isPropertyAccessExpression(expr)) {
          const objName = expr.expression.getText(sourceFile);
          const methodName = expr.name.getText(sourceFile);

          // Node.js crypto API detection
          if (objName === 'crypto' && 
              ['createHash', 'createHmac', 'createCipheriv', 'createDecipheriv'].includes(methodName)) {
            
            let algorithm: string | undefined;
            const firstArg = node.arguments[0];

            // Extract algorithm name from first argument
            if (firstArg) {
              if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
                algorithm = firstArg.text;
              } else if (ts.isIdentifier(firstArg)) {
                const sym = checker.getSymbolAtLocation(firstArg);
                if (sym?.valueDeclaration && ts.isVariableDeclaration(sym.valueDeclaration)) {
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
              
              // Determine primitive type
              let primitive = 'hash';
              if (methodName.includes('Cipher')) primitive = 'symmetric';
              if (methodName === 'createHmac') primitive = 'mac';
              
              const { severity, score } = assignRisk(quantumSafe, primitive, nameUp);

              const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              const snippet = snippetAt(fileText, node.getStart(sourceFile));

              if (!found[id]) {
                found[id] = {
                  id,
                  assetType: 'algorithm',
                  primitive,
                  name: nameUp,
                  description: `Detected in crypto.${methodName}()`,
                  quantumSafe,
                  detectionContexts: [{
                    filePath,
                    lineNumbers: [pos.line + 1],
                    snippet
                  }],
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

              console.log(`✅ Found: ${nameUp} | Severity: ${severity} | Risk: ${score}`);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    console.log(`📦 JS scan complete. Found ${Object.keys(found).length} algorithms.`);
    return Object.values(found);
  },
};