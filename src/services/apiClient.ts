export interface ChatApiMessage {
  role: 'user' | 'model';
  text: string;
}

interface RequestOptions {
  apiKey?: string;
}

interface JsonRequestOptions extends RequestOptions {
  body?: unknown;
  method?: 'GET' | 'POST';
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function requestJson<T>(path: string, options: JsonRequestOptions = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.apiKey ? { 'x-mistral-api-key': options.apiKey } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }

  return payload as T;
}

export function getBackendStatus(apiKey?: string) {
  return requestJson<{ hasServerApiKey: boolean; acceptsClientKey: boolean }>('/api/config', {
    apiKey,
  });
}

export function generateFact(apiKey: string | undefined, dialect: string) {
  return requestJson<{ fact: { title: string; content: string; category: string } }>('/api/fact', {
    method: 'POST',
    apiKey,
    body: { dialect },
  });
}

export function sendChatMessage(
  apiKey: string | undefined,
  systemInstruction: string,
  messages: ChatApiMessage[],
) {
  return requestJson<{ text: string }>('/api/chat', {
    method: 'POST',
    apiKey,
    body: { systemInstruction, messages },
  });
}
