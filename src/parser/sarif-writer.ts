// src/parser/sarif-writer.ts
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CryptoAsset } from './types';

interface SarifRule {
  id: string;
  name: string;
  shortDescription: {
    text: string;
  };
  fullDescription?: {
    text: string;
  };
  help?: {
    text: string;
  };
  properties?: {
    tags?: string[];
    severity?: string;
    'security-severity'?: string;
  };
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note' | 'none';
  message: {
    text: string;
  };
  locations: Array<{
    physicalLocation: {
      artifactLocation: {
        uri: string;
        uriBaseId?: string;
      };
      region: {
        startLine: number;
        endLine?: number;
        startColumn?: number;
        endColumn?: number;
        snippet?: {
          text: string;
        };
      };
    };
  }>;
  partialFingerprints?: {
    primaryLocationLineHash?: string;
  };
}

interface SarifDocument {
  version: '2.1.0';
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifRule[];
      };
    };
    results: SarifResult[];
    properties?: {
      statistics?: {
        totalDetected: number;
        highRisk: number;
        mediumRisk: number;
        lowRisk: number;
        quantumSafe: number;
        quantumVulnerable: number;
      };
    };
  }>;
}

/**
 * SARIF Format Writer for GitHub Code Scanning Integration
 */
export class SarifWriter {
  /**
   * Write SARIF report compatible with GitHub Code Scanning
   */
  async writeSarifReport(
    assets: CryptoAsset[],
    outputPath: string,
    category: string = 'CBOM:crypto-detector'
  ): Promise<void> {
    const rules = this.generateRules(assets);
    const results = this.generateResults(assets);

    const sarif: SarifDocument = {
      version: '2.1.0',
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      runs: [
        {
          tool: {
            driver: {
              name: 'Crypto Detector',
              version: '1.0.0',
              informationUri: 'https://github.com/Syed-Shail/Crypto-VS-code-extension',
              rules
            }
          },
          results,
          properties: {
            statistics: {
              totalDetected: assets.length,
              highRisk: assets.filter(a => a.severity === 'high').length,
              mediumRisk: assets.filter(a => a.severity === 'medium').length,
              lowRisk: assets.filter(a => a.severity === 'low').length,
              quantumSafe: assets.filter(a => a.quantumSafe === true).length,
              quantumVulnerable: assets.filter(a => a.quantumSafe === false).length
            }
          }
        }
      ]
    };

    await fs.writeFile(outputPath, JSON.stringify(sarif, null, 2), 'utf8');
    console.log(`✅ SARIF report written to ${outputPath}`);
  }

  /**
   * Generate SARIF rules from crypto assets
   */
  private generateRules(assets: CryptoAsset[]): SarifRule[] {
    const ruleMap = new Map<string, SarifRule>();

    for (const asset of assets) {
      const ruleId = this.generateRuleId(asset);
      
      if (!ruleMap.has(ruleId)) {
        ruleMap.set(ruleId, {
          id: ruleId,
          name: asset.name,
          shortDescription: {
            text: `${asset.name} cryptographic algorithm detected`
          },
          fullDescription: {
            text: asset.description || `${asset.name} is a ${asset.primitive || asset.type} algorithm`
          },
          help: {
            text: this.generateHelpText(asset)
          },
          properties: {
            tags: this.generateTags(asset),
            severity: asset.severity || 'low',
            'security-severity': this.mapToSecuritySeverity(asset.severity)
          }
        });
      }
    }

    return Array.from(ruleMap.values());
  }

  /**
   * Generate SARIF results from crypto assets
   */
  private generateResults(assets: CryptoAsset[]): SarifResult[] {
    const results: SarifResult[] = [];

    for (const asset of assets) {
      const ruleId = this.generateRuleId(asset);
      const level = this.mapSeverityToLevel(asset.severity);

      // Generate result for each detection context
      for (const ctx of asset.detectionContexts || []) {
        if (!ctx.filePath) continue;

        results.push({
          ruleId,
          level,
          message: {
            text: this.generateResultMessage(asset)
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: this.normalizeFilePath(ctx.filePath),
                  uriBaseId: '%SRCROOT%'
                },
                region: {
                  startLine: ctx.lineNumbers?.[0] || 1,
                  endLine: ctx.lineNumbers?.[ctx.lineNumbers.length - 1] || ctx.lineNumbers?.[0] || 1,
                  snippet: ctx.snippet ? {
                    text: ctx.snippet.substring(0, 200)
                  } : undefined
                }
              }
            }
          ],
          partialFingerprints: {
            primaryLocationLineHash: this.generateFingerprint(asset, ctx.filePath, ctx.lineNumbers?.[0])
          }
        });
      }
    }

    return results;
  }

  /**
   * Generate rule ID for an asset
   */
  private generateRuleId(asset: CryptoAsset): string {
    const type = asset.primitive || asset.type || 'unknown';
    const name = asset.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return `crypto/${type}/${name}`;
  }

  /**
   * Generate help text for an asset
   */
  private generateHelpText(asset: CryptoAsset): string {
    let help = `# ${asset.name}\n\n`;
    help += `**Type:** ${asset.primitive || asset.type}\n`;
    help += `**Quantum-Safe:** ${String(asset.quantumSafe)}\n`;
    help += `**Risk Score:** ${asset.riskScore || asset.score || 0}/100\n\n`;
    
    if (asset.reason) {
      help += `## Risk Assessment\n${asset.reason}\n\n`;
    }

    if (asset.quantumSafe === false) {
      help += `## Recommendation\n`;
      help += `This algorithm is vulnerable to quantum computing attacks. `;
      help += `Consider migrating to quantum-resistant alternatives:\n`;
      
      if (asset.type === 'asymmetric' || asset.primitive === 'asymmetric') {
        help += `- Kyber (key encapsulation)\n`;
        help += `- Dilithium (digital signatures)\n`;
        help += `- Falcon (compact signatures)\n`;
      } else if (asset.type === 'hash' || asset.primitive === 'hash') {
        help += `- SHA-256 or SHA-512 (longer output)\n`;
        help += `- SHA3-256 or SHA3-512\n`;
        help += `- BLAKE2b\n`;
      }
    }

    return help;
  }

  /**
   * Generate tags for categorization
   */
  private generateTags(asset: CryptoAsset): string[] {
    const tags: string[] = ['cryptography', 'security'];

    if (asset.primitive || asset.type) {
      tags.push(asset.primitive || asset.type);
    }

    if (asset.quantumSafe === false) {
      tags.push('quantum-vulnerable');
      tags.push('deprecated');
    } else if (asset.quantumSafe === true) {
      tags.push('post-quantum');
      tags.push('quantum-safe');
    }

    if (asset.severity === 'high') {
      tags.push('high-risk');
    }

    return tags;
  }

  /**
   * Generate result message
   */
  private generateResultMessage(asset: CryptoAsset): string {
    let message = `${asset.name} cryptographic algorithm detected`;
    
    if (asset.quantumSafe === false) {
      message += ' (quantum-vulnerable)';
    } else if (asset.quantumSafe === true) {
      message += ' (quantum-safe)';
    }

    if (asset.description) {
      message += `: ${asset.description}`;
    }

    return message;
  }

  /**
   * Map severity to SARIF level
   */
  private mapSeverityToLevel(severity?: string): 'error' | 'warning' | 'note' | 'none' {
    switch (severity) {
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'note';
      default:
        return 'none';
    }
  }

  /**
   * Map severity to GitHub security severity (0-10 scale)
   */
  private mapToSecuritySeverity(severity?: string): string {
    switch (severity) {
      case 'high':
        return '8.0';
      case 'medium':
        return '5.0';
      case 'low':
        return '2.0';
      default:
        return '0.0';
    }
  }

  /**
   * Normalize file path for SARIF (relative to source root)
   */
  private normalizeFilePath(filePath: string): string {
    // Convert to forward slashes
    let normalized = filePath.replace(/\\/g, '/');
    
    // Remove absolute path prefixes
    normalized = normalized.replace(/^[A-Za-z]:\//, '');
    normalized = normalized.replace(/^\/+/, '');
    
    return normalized;
  }

  /**
   * Generate fingerprint for deduplication
   */
  private generateFingerprint(
    asset: CryptoAsset,
    filePath?: string,
    line?: number
  ): string {
    const data = `${asset.name}:${filePath}:${line}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }
}

/**
 * Helper function to write SARIF report
 */
export async function writeSarifReport(
  assets: CryptoAsset[],
  outputPath: string,
  category?: string
): Promise<void> {
  const writer = new SarifWriter();
  await writer.writeSarifReport(assets, outputPath, category);
}