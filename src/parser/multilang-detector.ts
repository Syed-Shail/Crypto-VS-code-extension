import * as vscode from 'vscode';
import  Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';
import C from 'tree-sitter-c';
import Cpp from 'tree-sitter-cpp';
import * as fs from 'fs';
import * as path from 'path';
import { CryptoAsset } from './types.js';

/**
 * Supported language parsers
 */
const LANGUAGE_PARSERS: Record<string, any> = {
  '.py': Python,
  '.java': Java,
  '.c': C,
  '.cpp': Cpp
};

/**
 * Load JSON rule database dynamically
 */
const rulesPath = path.join(__dirname, 'rules', 'crypto-rules.json');
const CRYPTO_RULES = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

/**
 * Multi-language AST-based crypto detector
 */
export async function detectMultiLang(uri: vscode.Uri): Promise<CryptoAsset[]> {
  const ext = path.extname(uri.fsPath);
  const parserClass = LANGUAGE_PARSERS[ext];
  if (!parserClass) return [];

  const langKey = ext.replace('.', '');
  const langRules = CRYPTO_RULES[langKey] || [];

  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();

  const parser = new Parser();
  parser.setLanguage(parserClass);

  const tree = parser.parse(text);
  const results: CryptoAsset[] = [];

  function walk(node: any) {
    const snippet = text.slice(node.startIndex, node.endIndex);

    for (const rule of langRules) {
      if (snippet.includes(rule.api)) {
        const line = text.substring(0, node.startIndex).split('\n').length;
        results.push({
          id: `${langKey}:${rule.api}`,
          assetType: 'algorithm',
          primitive: rule.type,
          name: rule.api,
          quantumSafe: rule.quantumSafe,
          description: rule.description,
          detectionContexts: [{ filePath: uri.fsPath, lineNumbers: [line], snippet }],
          occurrences: 1
        });
      }
    }

    // Recursively visit children
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);
  return results;
}
