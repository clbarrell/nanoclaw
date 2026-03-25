/**
 * Channel-agnostic audio transcription using AssemblyAI.
 * Works with any audio buffer (Telegram voice notes, WhatsApp audio, etc.)
 */

import { logger } from './logger.js';

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY || '';

/**
 * Transcribe an audio buffer using AssemblyAI.
 * Returns the transcript text, or null on failure.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
): Promise<string | null> {
  if (!ASSEMBLYAI_API_KEY) {
    logger.warn('ASSEMBLYAI_API_KEY not set, skipping transcription');
    return null;
  }

  try {
    const { AssemblyAI } = await import('assemblyai');
    const client = new AssemblyAI({ apiKey: ASSEMBLYAI_API_KEY });

    // transcribe() handles upload + polling automatically
    const transcript = await client.transcripts.transcribe({
      audio: audioBuffer,
    });

    if (transcript.status === 'error') {
      logger.error({ error: transcript.error }, 'AssemblyAI transcription error');
      return null;
    }

    return transcript.text?.trim() || null;
  } catch (err) {
    logger.error({ err }, 'Transcription failed');
    return null;
  }
}
