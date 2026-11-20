export interface SocraticHintInput {
  challengeTitle: string;
  instructions: string;
  userCode: string;
  lastError: string;
  hintLevel: 1 | 2 | 3;
  misconceptionTitle?: string;
}

export interface SocraticCredentials {
  provider: 'openrouter' | 'gemini';
  openrouterApiKey: string;
  geminiApiKey: string;
}

const SOCRATIC_SYSTEM_PROMPT = `Eres un Tutor Socratico de Python basado en ciencia cognitiva.
Tu objetivo es PRESERVAR el esfuerzo cognitivo productivo del estudiante.

REGLAS ESTRICTAS (VIOLACION = FALLO):
1. PROHIBIDO escribir la solucion, reescribir la funcion del usuario o dar bloques de codigo de mas de 1 linea.
2. Responde en MAXIMO 3 oraciones cortas en espanol.
3. Senala la linea o invariante conceptual donde diverge el modelo mental del estudiante y termina con UNA pregunta socratica concreta que lo obligue a pensar el siguiente paso.`;

/**
 * Filtro duro anti-spoiling: elimina cualquier bloque de codigo multilinea
 * para garantizar que el LLM nunca entregue la solucion servida.
 */
export function enforceAntiSpoilingGuardrail(rawText: string): string {
  const withoutLongFences = rawText.replace(/```[\s\S]*?```/g, (block) => {
    const innerLines = block
      .replace(/^```[^\n]*\n?/, '')
      .replace(/```$/, '')
      .trim()
      .split('\n');
    if (innerLines.length > 2) {
      return '`[código omitido — piensa el siguiente paso por tu cuenta]`';
    }
    return block;
  });
  return withoutLongFences.trim().slice(0, 480);
}

export async function requestSocraticHint(
  input: SocraticHintInput,
  credentials: SocraticCredentials
): Promise<string> {
  const userContent = JSON.stringify({
    challengeTitle: input.challengeTitle,
    instructions: input.instructions.slice(0, 400),
    hintLevel: input.hintLevel,
    misconceptionDetected: input.misconceptionTitle,
    lastError: input.lastError.slice(0, 500),
    userCode: input.userCode.slice(0, 1200),
  });

  if (credentials.provider === 'gemini' && credentials.geminiApiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${credentials.geminiApiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SOCRATIC_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 220 },
      }),
    });
    if (!res.ok) throw new Error(`Error del tutor (${res.status})`);
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return enforceAntiSpoilingGuardrail(text);
  }

  if (credentials.openrouterApiKey) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.openrouterApiKey}`,
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://living-books.app',
        'X-Title': 'Universal Living Book Engine',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'system', content: SOCRATIC_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 220,
      }),
    });
    if (!res.ok) throw new Error(`Error del tutor (${res.status})`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    return enforceAntiSpoilingGuardrail(text);
  }

  throw new Error('Configura una API Key en Ajustes para usar el Tutor Socrático.');
}
