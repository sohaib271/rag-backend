export function inspectExtractedText(
  text: string,
): {
  normalizedText: string;
  suspiciousCharacters: string[];
  promptInjectionIndicators: string[];
  isSuspicious: boolean;
  warnings: string[];
} {
  const suspiciousCharacters: string[] = [];
  const promptInjectionIndicators: string[] = [];
  const warnings: string[] = [];

  // Zero-width and certain invisible formatting characters.
  const invisiblePattern =
    /(?:\u200B|\u200C|\u200D|\u2060|\uFEFF)/g;

  const matches = text.match(invisiblePattern);

  if (matches) {
    suspiciousCharacters.push(
      ...new Set(
        matches.map((char) =>
          `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
        ),
      ),
    );
  }

  if (!text.trim()) {
    warnings.push('No extractable text was found.');
  }

  // Normalize common line endings and remove surrounding whitespace.
  const normalizedText = text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim();

  const injectionPatterns = [
    {
      name: 'Instruction override',
      pattern: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+(?:instructions|rules|prompts|directions)\b/i,
    },
    {
      name: 'Role impersonation',
      pattern: /\b(?:you are now|act as|pretend to be)\s+(?:the\s+|an?\s+)?(?:system|developer|administrator|admin)\b/i,
    },
    {
      name: 'Concealment instruction',
      pattern: /\b(?:do not|don't|never)\s+(?:mention|reveal|disclose)\s+(?:this|these|the)\s+(?:note|instruction|prompt|message)\b/i,
    },
    {
      name: 'Forged role delimiter',
      pattern: /<\|(?:system|developer|assistant)\|>|\[(?:SYSTEM|DEVELOPER)\]/i,
    },
  ];

  for (const { name, pattern } of injectionPatterns) {
    if (pattern.test(normalizedText)) {
      promptInjectionIndicators.push(name);
    }
  }

  if (suspiciousCharacters.length > 0) {
    warnings.push(
      'Invisible formatting characters were detected; inspect before deciding whether to remove them.',
    );
  }

  if (promptInjectionIndicators.length > 0) {
    warnings.push('Possible prompt-injection instructions were detected.');
  }

  return {
    normalizedText,
    suspiciousCharacters,
    promptInjectionIndicators,
    isSuspicious: promptInjectionIndicators.length > 0,
    warnings,
  };
}
