// src/parser/algorithm-db.ts
export interface AlgorithmDef {
  id: string;
  names: string[]; // textual variants
  regex?: RegExp;
  apiSignatures?: { [lang: string]: string[] };
  primitive: 'hash' | 'symmetric' | 'asymmetric' | 'mac' | 'pqc' | 'other';
  parameter?: string;
  oid?: string;
  pqc?: boolean;
}

export const ALGO_DB: AlgorithmDef[] = [
  {
    id: 'sha256',
    names: ['SHA256', 'sha-256'],
    regex: /\bsha-?256\b/gi,
    apiSignatures: {
      java: ['MessageDigest.getInstance'],
      js: ['crypto.createHash', 'crypto.createHmac'],
      python: ['hashlib.sha256']
    },
    primitive: 'hash',
    parameter: '256',
    oid: '2.16.840.1.101.3.4.2.1'
  },
  {
    id: 'rsa',
    names: ['RSA'],
    regex: /\brsa[-_]?(2048|4096)?\b/gi,
    apiSignatures: { java: ['KeyPairGenerator.getInstance'], js: [] },
    primitive: 'asymmetric',
    parameter: '2048'
  },
  {
    id: 'aes',
    names: ['AES'],
    regex: /\baes(?:[-_]?(128|192|256))?\b/gi,
    apiSignatures: { js: ['crypto.createCipheriv', 'crypto.createDecipheriv'] },
    primitive: 'symmetric',
    parameter: '128/192/256'
  },
  {
    id: 'kyber',
    names: ['KYBER'],
    regex: /\bkyber\b/gi,
    apiSignatures: { js: ['Kyber'] },
    primitive: 'pqc',
    pqc: true
  },
  {
    id: 'dilithium',
    names: ['DILITHIUM'],
    regex: /\bdilithium\b/gi,
    primitive: 'pqc',
    pqc: true
  },
  // add more as you go...
];
