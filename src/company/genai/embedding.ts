import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: "AQ.Ab8RN6Ih2hl-wXTBzLRulHU69bRr7Pr5IqtkSu0ehmvRrswcLg",
});

export async function getEmbeddings(chunk: string[]) { 

const response = await ai.models.embedContent({
  model: "gemini-embedding-001",
  contents: chunk,
  config: {
    outputDimensionality: 768,
    taskType: 'RETRIEVAL_DOCUMENT',
  },
})
if(!response.embeddings || response.embeddings.length === 0) {
  throw new Error("No embeddings returned from the API.");
}
return response.embeddings;
}
