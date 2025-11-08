// src/parser/multilang-detector.ts

import * as vscode from 'vscode';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';
import C from 'tree-sitter-c';
import Cpp from 'tree-sitter-cpp';
import * as fs from 'fs';
import * as path from 'path';
import { CryptoAsset } from './types.js';
import { assignRisk } from './risk-utils.js';

/* --------------------------------------------------------------------------
 * 🌍 Supported Language Parsers
 * -------------------------------------------------------------------------- */
const LANGUAGE_PARSERS: Record<string, any> = {
  '.py': Python,
  '.java': Java,
  '.c': C,
  '.cpp': Cpp
};

/* --------------------------------------------------------------------------
 * 📘 Load Crypto Rules (JSON database)
 * -------------------------------------------------------------------------- */
const rulesPath = path.join(__dirname, 'rules', 'crypto-rules.json');
const CRYPTO_RULES = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

/* --------------------------------------------------------------------------
 * 🧠 Multi-language Crypto Detector
 * -------------------------------------------------------------------------- */
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

  /* ----------------------------------------------------------------------
   * 🔍 Walk the AST nodes and match against crypto rules
   * ---------------------------------------------------------------------- */
  function walk(node: any) {
    const snippet = text.slice(node.startIndex, node.endIndex);

    for (const rule of langRules) {
      if (snippet.includes(rule.api)) {
        const line = text.substring(0, node.startIndex).split('\n').length;

        // 🔹 Use risk engine to assign real risk levels
        const { severity, score, explanation } = assignRisk(rule.quantumSafe, rule.type, rule.api);

        console.log(
          `🧠 Risk assigned for ${rule.api} [${rule.type}] — Severity: ${severity}, Risk: ${score}`
        );

        results.push({
          id: `${langKey}:${rule.api}`,
          assetType: 'algorithm',
          primitive: rule.type,
          name: rule.api,
          quantumSafe: rule.quantumSafe,
          description: `${rule.description || 'Detected cryptographic algorithm'} — ${explanation}`,
          detectionContexts: [
            { filePath: uri.fsPath, lineNumbers: [line], snippet }
          ],
          occurrences: 1,
          severity,
          riskScore: score
        });
      }
    }

    // Recursively visit all child nodes
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(tree.rootNode);
  console.log(
    `📦 [MULTILANG] Scan complete for ${path.basename(uri.fsPath)} — Found ${results.length} algorithms`
  );
  return results;
}
