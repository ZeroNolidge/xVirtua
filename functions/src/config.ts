import { defineSecret } from 'firebase-functions/params';

/**
 * All vendor keys live in Secret Manager (or functions/.secret.local for the
 * emulator). They are never sent to the client.
 */
export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
export const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
export const CARTESIA_API_KEY = defineSecret('CARTESIA_API_KEY');

export const REGION = 'us-east1';
