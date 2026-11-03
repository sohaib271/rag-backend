import { getGeminiClient } from './gemini-client.js';

export async function getResponseFromGemini(
  context: string,
  query: string
) {
  const response = await getGeminiClient().models.generateContent({
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

Never infer or convert a currency from the customer's locale or the business
timezone. Preserve every currency symbol and currency code exactly as it
appears in the supplied context.

Keep the answer concise and suitable for WhatsApp.
      `.trim(),
      temperature: 0.1,
    },
  });

  return response.text;
}
