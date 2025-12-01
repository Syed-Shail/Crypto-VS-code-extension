import Parser from 'web-tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

export type WasmLang = 'python' | 'java' | 'c' | 'cpp' | 'javascript';

type ParserMap = Partial<Record<WasmLang, Parser>>;

let initPromise: Promise<ParserMap> | null = null;
let isInitialized = false;

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
    
    if (!fs.existsSync(wasmPath)) {
      console.warn(`[TS-WASM] Grammar file not found: ${wasmPath}`);
      return null;
    }

    const bytes = fs.readFileSync(wasmPath);
    const lang = await Parser.Language.load(bytes);
    const parser = new Parser();
    parser.setLanguage(lang);
    console.log(`[TS-WASM] ✅ Loaded ${filename} for ${langKey}`);
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
 *   out/parser/grammars/tree-sitter-python.wasm
 */
export async function getParsers(): Promise<ParserMap> {
  if (!initPromise) {
    initPromise = (async () => {
      if (!isInitialized) {
        try {
          await Parser.init();
          isInitialized = true;
          console.log('[TS-WASM] ✅ Parser.init() complete');
        } catch (err) {
          console.error('[TS-WASM] ❌ Failed to initialize Parser:', err);
          return {};
        }
      }

      const baseDir = path.join(__dirname, 'grammars');
      
      // Check if grammar directory exists
      if (!fs.existsSync(baseDir)) {
        console.warn(`[TS-WASM] Grammar directory not found: ${baseDir}`);
        console.warn('[TS-WASM] Run "npm run download-grammars" to download grammar files');
        return {};
      }

      const entries: Array<[WasmLang, Parser]> = [];

      const configs: Array<[WasmLang, string]> = [
        ['python', 'tree-sitter-python.wasm'],
        ['java', 'tree-sitter-java.wasm'],
        ['c', 'tree-sitter-c.wasm'],
        ['cpp', 'tree-sitter-cpp.wasm'],
        ['javascript', 'tree-sitter-javascript.wasm']
      ];

      for (const [langKey, filename] of configs) {
        const pair = await loadLanguage(langKey, filename, baseDir);
        if (pair) entries.push(pair);
      }

      const map: ParserMap = {};
      for (const [k, p] of entries) {
        map[k] = p;
      }

      if (Object.keys(map).length === 0) {
        console.warn('[TS-WASM] ⚠️  No parsers loaded. AST detection will be disabled.');
        console.warn('[TS-WASM] Run "npm run download-grammars" and "npm run compile" to enable AST detection.');
      } else {
        console.log(`[TS-WASM] ✅ Loaded ${Object.keys(map).length} parser(s):`, Object.keys(map).join(', '));
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
  if (['.cpp', '.cc', '.cxx', '.hpp', '.h'].includes(normalized) && parsers.cpp) {
    return { langKey: 'cpp', parser: parsers.cpp };
  }
  if (['.js', '.jsx', '.mjs'].includes(normalized) && parsers.javascript) {
    return { langKey: 'javascript', parser: parsers.javascript };
  }
  if (['.ts', '.tsx'].includes(normalized) && parsers.javascript) {
    // JavaScript parser can handle TypeScript syntax reasonably well
    return { langKey: 'javascript', parser: parsers.javascript };
  }

  return null;
}

/**
 * Check if parsers are available
 */
export async function areParsersAvailable(): Promise<boolean> {
  const parsers = await getParsers();
  return Object.keys(parsers).length > 0;
}