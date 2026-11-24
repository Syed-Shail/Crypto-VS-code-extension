// src/core/scan-cache.ts - persistent per-file result cache for repository scans
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CryptoAsset } from '../parser/types';

interface CacheEntry {
  size: number;
  mtimeMs: number;
  hash: string;
  assets: CryptoAsset[];
}

interface CacheFile {
  version: string;
  entries: Record<string, CacheEntry>;
}

/**
 * Remembers the analysis result of every scanned file.
 *
 * A file is reused without being read when its size and modification time are unchanged,
 * and without being re-analysed when its content hash is unchanged. The cache is keyed by
 * a version string built from the extension version and the detection rules, so editing
 * the rules invalidates every entry automatically.
 */
export class ScanCache {
  hits = 0;
  misses = 0;
  private dirty = false;

  private constructor(private readonly file: string, private readonly version: string, private entries: Record<string, CacheEntry>) {}

  static async open(file: string, version: string): Promise<ScanCache> {
    try {
      const data: CacheFile = JSON.parse(await fs.readFile(file, 'utf8'));
      if (data.version === version && data.entries) {
        return new ScanCache(file, version, data.entries);
      }
    } catch {
      // missing or unreadable cache: start empty
    }
    return new ScanCache(file, version, {});
  }

  /** Default cache location for a scanned folder: ~/.cache/crypto-detector/<hash of folder>.json */
  static defaultPath(root: string, baseDir = path.join(os.homedir(), '.cache', 'crypto-detector')): string {
    const id = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 16);
    return path.join(baseDir, `${id}.json`);
  }

  static hash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /** Reuse a result when the file's size and modification time match the cached entry. */
  byStat(filePath: string, stat: { size: number; mtimeMs: number }): CryptoAsset[] | undefined {
    const entry = this.entries[filePath];
    if (entry && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs) {
      this.hits++;
      return entry.assets;
    }
    return undefined;
  }

  /** Reuse a result when the content is identical even though the timestamp changed (e.g. after a checkout). */
  byHash(filePath: string, hash: string, stat: { size: number; mtimeMs: number }): CryptoAsset[] | undefined {
    const entry = this.entries[filePath];
    if (entry && entry.hash === hash) {
      this.hits++;
      this.entries[filePath] = { ...entry, size: stat.size, mtimeMs: stat.mtimeMs };
      this.dirty = true;
      return entry.assets;
    }
    this.misses++;
    return undefined;
  }

  store(filePath: string, stat: { size: number; mtimeMs: number }, hash: string, assets: CryptoAsset[]): void {
    this.entries[filePath] = { size: stat.size, mtimeMs: stat.mtimeMs, hash, assets };
    this.dirty = true;
  }

  /** Drop entries for files that no longer exist in the scanned folder. */
  retainOnly(paths: Iterable<string>): void {
    const keep = new Set(paths);
    for (const key of Object.keys(this.entries)) {
      if (!keep.has(key)) {
        delete this.entries[key];
        this.dirty = true;
      }
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: this.version, entries: this.entries } as CacheFile));
    await fs.rename(tmp, this.file); // atomic replace, so an interrupted scan never leaves a corrupt cache
    this.dirty = false;
  }
}

/** Version of the analysis: changes whenever the extension version or the detection rules change. */
export function analysisVersion(): string {
  const root = path.resolve(__dirname, '..', '..');
  const parts: string[] = [];
  for (const file of [path.join(root, 'package.json'), path.join(__dirname, '..', 'parser', 'rules', 'crypto-rules.json')]) {
    try {
      parts.push(fsSync.readFileSync(file, 'utf8'));
    } catch {
      parts.push(file);
    }
  }
  return crypto.createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);
}
