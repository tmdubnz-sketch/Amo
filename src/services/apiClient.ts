export interface ChatApiMessage {
  role: 'user' | 'model';
  text: string;
}

const mistralApiUrl = 'https://api.mistral.ai/v1/chat/completions';

function extractDirectContent(payload: any) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === 'string' ? item : item?.text || ''))
      .join('')
      .trim();
  }

  return '';
}

function extractJsonObject(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fencedMatch?.[1] || text).trim();
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON object found in model response.');
  }

  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

async function callMistralDirect<T>(apiKey: string, body: Record<string, unknown>, transform: (payload: any) => T) {
  let response: Response;

  try {
    response = await fetch(mistralApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error('Could not reach Mistral directly. Check your network connection and API key.');
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || 'Direct Mistral request failed.');
  }

  return transform(payload);
}

export function generateFact(apiKey: string | undefined, dialect: string) {
  if (!apiKey) {
    throw new Error('Add a Mistral API key in settings to generate facts.');
  }

  return callMistralDirect(
    apiKey,
    {
      model: 'mistral-small-latest',
      temperature: 0.8,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Return only JSON with the keys title, content, and category. Valid categories are Culture, History, Language, Maori Proverbs (Whakatauki), Maori Art & Design, Maori Landmarks, and Maori Mythology (Purakau).',
        },
        {
          role: 'user',
          content: `Share one short, interesting fact or tip about Maori culture, history, or Te Reo Maori. Keep it concise and engaging. Lean into the ${dialect || 'General / Standard'} dialect perspective when relevant.`,
        },
      ],
    },
    (payload) => ({ fact: extractJsonObject(extractDirectContent(payload)) }),
  );
}

export function sendChatMessage(
  apiKey: string | undefined,
  systemInstruction: string,
  messages: ChatApiMessage[],
) {
  if (!apiKey) {
    throw new Error('Add a Mistral API key in settings to send messages directly.');
  }

  return callMistralDirect(
    apiKey,
    {
      model: 'mistral-small-latest',
      temperature: 0.7,
      messages: [
        ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
        ...messages.map((message) => ({
          role: message.role === 'model' ? 'assistant' : 'user',
          content: message.text,
        })),
      ],
    },
    (payload) => ({ text: extractDirectContent(payload) || 'Sorry bro, I got a bit tangled up there. Can you say that again?' }),
  );
}
