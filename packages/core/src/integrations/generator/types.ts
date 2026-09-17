import type { EvidenceClaim, EvidenceSource, VoiceTraits } from '../../db/schema';

export const CONTENT_MODES = ['informative', 'educational', 'technical', 'simple', 'opinion', 'breaking'] as const;
export type ContentMode = (typeof CONTENT_MODES)[number];

export const CONTENT_MODE_LABELS: Record<ContentMode, string> = {
  informative: 'Informativo',
  educational: 'Educativo',
  technical: 'Técnico',
  simple: 'Explicación sencilla',
  opinion: 'Opinión (según posicionamiento)',
  breaking: 'Noticia urgente',
};

export type GenerationInput = {
  channel: 'x';
  mode: ContentMode;
  angle?: string;
  brand: { name: string; positioning: string; audience: string; language: string; goals: string };
  voice: VoiceTraits;
  approvedExamples: string[];
  recentPosts: string[];
  evidence: {
    title: string;
    whatHappened: string;
    confirmed: EvidenceClaim[];
    uncertain: EvidenceClaim[];
    sources: EvidenceSource[];
    insufficient: boolean;
  };
};

export type GenerationOutput = {
  text: string;
  angle: string;
  references: { url: string; title: string }[];
  reviewNotes: string[];
  /** simulated | claude:<modelo> */
  generator: string;
  costUsd: number;
};

export interface ContentGenerator {
  readonly id: string;
  readonly live: boolean;
  generate(input: GenerationInput): Promise<GenerationOutput>;
}
