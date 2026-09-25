// `knowledge-source.mjs` нь plain JS (preDeploy-д tsx байхгүй байж болзошгүй) —
// тест ба TS дуудагчид зориулсан төрлийн зарлал.

export interface TarFile {
  path: string;
  content: string;
}

export function extractTarFiles(tar: Buffer, options?: { stripComponents?: number }): TarFile[];
export function isCompleteKnowledgeSource(paths: string[]): boolean;
export function normalizeKnowledgeRepo(value: unknown): string | null;
