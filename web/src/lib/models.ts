import type { PatientModel } from '@plainspeak/shared';

export const MODEL_LABELS: Record<PatientModel, string> = {
  'claude-opus-5-5': 'Opus 5.5: most natural, slower',
  'claude-sonnet-5-5': 'Sonnet 5.5: balanced',
  'claude-haiku-5-5': 'Haiku 5.5: fastest, cheapest',
};
