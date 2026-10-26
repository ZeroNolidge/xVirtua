/** How a GPT-Live voice sounds, as tagged by faculty. */
export type VoiceTag = 'male' | 'female' | 'neutral';
export const TAG_LABEL: Record<VoiceTag, string> = {
  male: 'Male',
  female: 'Female',
  neutral: 'Neutral',
};
