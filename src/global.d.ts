// src/global.d.ts

// Minimal typings for web-tree-sitter so TypeScript stops complaining.
declare module 'web-tree-sitter' {
  export default class Parser {
    static init(): Promise<void>;

    static Language: {
      load(
        input: string | Uint8Array | ArrayBuffer | Buffer
      ): Promise<Language>;
    };

    setLanguage(language: Language): void;
    parse(input: string): Tree;
  }

  export class Language {}

  export class Tree {
    rootNode: SyntaxNode;
  }

  export class SyntaxNode {
    type: string;
    startIndex: number;
    endIndex: number;
    childCount: number;
    children: SyntaxNode[];

    child(index: number): SyntaxNode;
  }
}
