import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: "AQ.Ab8RN6Ih2hl-wXTBzLRulHU69bRr7Pr5IqtkSu0ehmvRrswcLg",
});

export async function getResponseFromGemini(
  context: string,
  query: string
) {
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash-lite",
    contents: `
Context:
${context}

Customer question:
${query}
    `.trim(),
    config: {
      systemInstruction: `
You are a company customer-support assistant.

Answer only from the supplied context.

If the context does not contain the answer, say that you do not have
enough information and offer to connect the customer to an admin.

Do not invent company policies.

Keep the answer concise and suitable for WhatsApp.
      `.trim(),
      temperature: 0.1,
    },
  });

  return response.text;
}