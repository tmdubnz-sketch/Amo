import { AI_CONFIG } from '../config/ai';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

export interface ChatApiMessage {
  role: 'user' | 'model';
  text: string;
}

const mistralApiUrl = AI_CONFIG.chat.apiUrl;

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
  if (Capacitor.isNativePlatform()) {
    try {
      const response = await CapacitorHttp.request({
        url: mistralApiUrl,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        data: body,
      });

      const payload = response.data;

      if (response.status < 200 || response.status >= 300) {
        throw new Error(payload?.message || payload?.error?.message || payload?.error || 'Direct Mistral request failed.');
      }

      return transform(payload);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Mistral')) throw error;
      throw new Error('Could not reach Mistral. Check your network connection and API key.');
    }
  } else {
    // Web fallback
    const response = await fetch(mistralApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.message || payload?.error?.message || payload?.error || 'Direct Mistral request failed.');
    }

    return transform(payload);
  }
}

export function generateFact(apiKey: string | undefined) {
  if (!apiKey) {
    throw new Error('Add a Mistral API key in settings to generate facts.');
  }

  return callMistralDirect(
    apiKey,
    {
      model: AI_CONFIG.chat.model,
      temperature: AI_CONFIG.chat.temperature.fact,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Return only JSON with the keys title, content, and category. Valid categories are Culture, History, Language, Proverbs, Art & Design, Landmarks, and Mythology.',
        },
        {
          role: 'user',
          content: `Share one short, interesting fact or tip about culture, history, language, or the natural world. Keep it concise and engaging.`,
        },
      ],
    },
    (payload) => ({ fact: extractJsonObject(extractDirectContent(payload)) }),
  );
}

export async function* streamChatMessage(
  apiKey: string | undefined,
  systemInstruction: string,
  messages: ChatApiMessage[],
) {
  if (!apiKey) {
    throw new Error('Add a Mistral API key in settings to send messages directly.');
  }

  // NOTE: True word-by-word streaming is difficult with CapacitorHttp.
  // We will perform a normal request and 'simulate' streaming for UI consistency 
  // until we implement a custom native streamer.
  const response = await callMistralDirect(
    apiKey,
    {
      model: AI_CONFIG.chat.model,
      temperature: AI_CONFIG.chat.temperature.chat,
      messages: [
        ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
        ...messages.map((message) => ({
          role: message.role === 'model' ? 'assistant' : 'user',
          content: message.text,
        })),
      ],
    },
    (payload) => extractDirectContent(payload)
  );

  // Simulate streaming for the UI
  const chunks = response.split(' ');
  for (const chunk of chunks) {
    yield chunk + ' ';
    await new Promise(r => setTimeout(r, 30)); // Natural reading speed
  }
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
      model: AI_CONFIG.chat.model,
      temperature: AI_CONFIG.chat.temperature.chat,
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
