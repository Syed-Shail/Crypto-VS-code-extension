export interface DetectionContext {
  filePath: string;
  lineNumbers: number[];
  snippet?: string;
}

export interface CryptoAsset {
  id: string;
  assetType: 'algorithm' | 'library' | 'key' | 'certificate';
  primitive: string;
  name: string;
  variant?: string;
  keySize?: number | string;
  quantumSafe?: boolean | 'partial' | 'unknown';
  description?: string;
  detectionContexts: DetectionContext[];
  occurrences: number;
  severity?: 'low' | 'medium' | 'high';
  riskScore?: number;
}
