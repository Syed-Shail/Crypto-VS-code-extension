import { CryptoAsset } from './types';
import * as path from 'path';
import { getQuantumAlternativeSuggestion } from './quantum-alternatives';

type CycloneDxPrimitive =
  | 'drbg' | 'mac' | 'blockcipher' | 'streamcipher' | 'signature' | 'hash'
  | 'pke' | 'xof' | 'key-agree' | 'kem' | 'kdf' | 'ae' | 'unknown';

function toCycloneDxPrimitive(asset: CryptoAsset): CycloneDxPrimitive {
  const type = (asset.primitive || asset.type || '').toLowerCase();
  const name = asset.name.toLowerCase().replace(/[+\s_-]/g, '');

  if (type === 'hash') return 'hash';
  if (type === 'mac') return 'mac';
  if (type === 'pqc' && /^(mlkem|kyber)/.test(name)) return 'kem';
  if (type === 'key-exchange' || /^(ecdh|x25519|x448)/.test(name)) return 'key-agree';
  if (/^(ecdsa|ed25519|ed448|dsa|mldsa|dilithium|slhdsa|sphincs)/.test(name)) return 'signature';
  if (/^(aes|des|3des|tripledes|blowfish|twofish)/.test(name)) return 'blockcipher';
  if (/^(rc4|arc4|chacha|salsa)/.test(name)) return 'streamcipher';
  if (type === 'symmetric') return 'unknown';
  return 'unknown';
}

function getToolVersion(): string {
  try {
    return require('../../package.json').version as string;
  } catch {
    return 'unknown';
  }
}

function uniqueAssets(assets: CryptoAsset[]): CryptoAsset[] {
  const byAlgorithm = new Map<string, CryptoAsset>();
  for (const asset of assets) {
    const key = `${asset.name.trim().toLowerCase()}::${toCycloneDxPrimitive(asset)}`;
    const existing = byAlgorithm.get(key);
    if (!existing) {
      byAlgorithm.set(key, { ...asset, detectionContexts: [...(asset.detectionContexts ?? [])] });
      continue;
    }
    existing.detectionContexts = [...(existing.detectionContexts ?? []), ...(asset.detectionContexts ?? [])];
    existing.occurrences = (existing.occurrences ?? 1) + (asset.occurrences ?? 1);
  }
  return Array.from(byAlgorithm.values());
}

/** Build a CycloneDX 1.7 document. Tool-specific analysis belongs in `properties`,
 * while `cryptoProperties` is kept to fields defined by the CycloneDX schema. */
export function createCbomDocument(assets: CryptoAsset[], sourceRoot?: string, toolVersion = getToolVersion()) {
  const components = uniqueAssets(assets).map((asset, index) => {
    const contexts = asset.detectionContexts?.length
      ? asset.detectionContexts
      : [{ filePath: asset.source, lineNumbers: asset.line ? [asset.line] : [], snippet: '' }];
    const properties = [
      { name: 'crypto-detector:severity', value: asset.severity ?? 'unknown' },
      { name: 'crypto-detector:quantum-status', value: String(asset.quantumSafe ?? 'unknown') },
      { name: 'crypto-detector:quantum-impact', value: asset.quantumImpact ?? 'unknown' },
      { name: 'crypto-detector:classical-security-status', value: asset.classicalSecurityStatus ?? 'unknown' },
      { name: 'crypto-detector:detection-confidence', value: asset.confidence ?? 'unknown' },
      { name: 'crypto-detector:assessment', value: asset.reason ?? 'No assessment available.' },
      { name: 'crypto-detector:migration-guidance', value: getQuantumAlternativeSuggestion(asset).alternative },
      { name: 'crypto-detector:migration-guidance-rationale', value: getQuantumAlternativeSuggestion(asset).rationale }
    ];

    return {
      type: 'cryptographic-asset',
      'bom-ref': `crypto-detector-${index + 1}`,
      name: asset.name || 'Unknown',
      evidence: {
        occurrences: contexts.flatMap(context => (context.lineNumbers?.length ? context.lineNumbers : [undefined]).map(line => ({
          location: toReportPath(context.filePath || asset.source || 'unknown', sourceRoot),
          ...(line !== undefined ? { line } : {}),
          ...(context.startOffset !== undefined || asset.startOffset !== undefined
            ? { offset: context.startOffset ?? asset.startOffset }
            : {}),
        })))
      },
      cryptoProperties: {
        assetType: 'algorithm',
        algorithmProperties: {
          primitive: toCycloneDxPrimitive(asset),
          cryptoFunctions: ['unknown']
        }
      },
      properties
    };
  });

  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.7.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.7',
    serialNumber: `urn:uuid:${require('crypto').randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: {
        components: [{
          type: 'application',
          'bom-ref': 'crypto-detector-tool',
          name: 'Crypto Detector',
          publisher: 'Syed Shail',
          version: toolVersion
        }]
      }
    },
    components
  };
}

function toReportPath(filePath: string, sourceRoot?: string): string {
  if (!path.isAbsolute(filePath)) return filePath.replace(/\\/g, '/');
  if (!sourceRoot) return path.basename(filePath);
  const relative = path.relative(path.resolve(sourceRoot), path.resolve(filePath));
  if (!relative || relative === '.') return path.basename(filePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return path.basename(filePath);
  }
  return relative.split(path.sep).join('/');
}
