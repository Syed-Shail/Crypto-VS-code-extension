// src/parser/ts-wasm.ts

import Parser from 'web-tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

export type WasmLang = 'python' | 'java' | 'c' | 'cpp';

type ParserMap = Partial<Record<WasmLang, Parser>>;

let initPromise: Promise<ParserMap> | null = null;

/**
 * Load a single language grammar from a local .wasm file.
 */
async function loadLanguage(
  langKey: WasmLang,
  filename: string,
  baseDir: string
): Promise<[WasmLang, Parser] | null> {
  try {
    const wasmPath = path.join(baseDir, filename);
    const bytes = fs.readFileSync(wasmPath);
    const lang = await Parser.Language.load(bytes);
    const parser = new Parser();
    parser.setLanguage(lang);
    console.log(`[TS-WASM] Loaded ${filename} for ${langKey}`);
    return [langKey, parser];
  } catch (err) {
    console.warn(
      `[TS-WASM] Failed to load ${filename} for ${langKey} — AST disabled for this language.`,
      err
    );
    return null;
  }
}

/**
 * Initialize all available WASM parsers once.
 * Expects .wasm grammar files to be present in:
 *   <outDir>/parser/grammars/
 *
 * e.g. after build:
 *   dist/parser/grammars/tree-sitter-python.wasm
 */
export async function getParsers(): Promise<ParserMap> {
  if (!initPromise) {
    initPromise = (async () => {
      await Parser.init();

      const baseDir = path.join(__dirname, 'grammars');
      const entries: Array<[WasmLang, Parser]> = [];

      const configs: Array<[WasmLang, string]> = [
        ['python', 'tree-sitter-python.wasm'],
        ['java', 'tree-sitter-java.wasm'],
        ['c', 'tree-sitter-c.wasm'],
        ['cpp', 'tree-sitter-cpp.wasm']
      ];

      for (const [langKey, filename] of configs) {
        const pair = await loadLanguage(langKey, filename, baseDir);
        if (pair) entries.push(pair);
      }

      const map: ParserMap = {};
      for (const [k, p] of entries) {
        map[k] = p;
      }
      return map;
    })();
  }

  return initPromise;
}

/**
 * Get a parser for a file extension (e.g. ".py", ".java").
 */
export async function getParserForExtension(
  ext: string
): Promise<{ langKey: WasmLang; parser: Parser } | null> {
  const parsers = await getParsers();
  const normalized = ext.toLowerCase();

  if (normalized === '.py' && parsers.python) {
    return { langKey: 'python', parser: parsers.python };
  }
  if (normalized === '.java' && parsers.java) {
    return { langKey: 'java', parser: parsers.java };
  }
  if (normalized === '.c' && parsers.c) {
    return { langKey: 'c', parser: parsers.c };
  }
  if (['.cpp', '.cc', '.cxx'].includes(normalized) && parsers.cpp) {
    return { langKey: 'cpp', parser: parsers.cpp };
  }

  return null;
}
