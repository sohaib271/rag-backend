import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | undefined;

export function getGeminiClient() {
  if (client) return client;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is missing. Add it to rag-backend/.env and restart the backend.',
    );
  }

  client = new GoogleGenAI({ apiKey });
  return client;
}
