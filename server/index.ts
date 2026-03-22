import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 8787);
const mistralApiUrl = 'https://api.mistral.ai/v1/chat/completions';
const defaultModel = process.env.MISTRAL_MODEL || 'mistral-small-latest';

app.use(express.json({ limit: '1mb' }));

type ApiMessage = {
  role: 'user' | 'model';
  text: string;
};

function resolveApiKey(headerValue?: string | string[]) {
  const clientKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return clientKey || process.env.MISTRAL_API_KEY || '';
}

function extractContent(payload: any) {
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

async function callMistral(apiKey: string, body: Record<string, unknown>) {
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
    const message = payload?.message || payload?.error || 'Mistral request failed.';
    throw new Error(message);
  }

  return payload;
}

app.get('/api/config', (req, res) => {
  const apiKey = resolveApiKey(req.header('x-mistral-api-key'));

  res.json({
    hasServerApiKey: Boolean(process.env.MISTRAL_API_KEY),
    acceptsClientKey: Boolean(apiKey),
  });
});

app.post('/api/chat', async (req, res) => {
  try {
    const apiKey = resolveApiKey(req.header('x-mistral-api-key'));

    if (!apiKey) {
      return res.status(400).json({ error: 'Add a Mistral API key in settings or on the server.' });
    }

    const { systemInstruction, messages } = req.body as {
      systemInstruction?: string;
      messages?: ApiMessage[];
    };

    const payload = await callMistral(apiKey, {
      model: defaultModel,
      temperature: 0.7,
      messages: [
        ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
        ...((messages || []).map((message) => ({
          role: message.role === 'model' ? 'assistant' : 'user',
          content: message.text,
        }))),
      ],
    });

    res.json({
      text: extractContent(payload) || 'Sorry bro, I got a bit tangled up there. Can you say that again?',
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/fact', async (req, res) => {
  try {
    const apiKey = resolveApiKey(req.header('x-mistral-api-key'));

    if (!apiKey) {
      return res.status(400).json({ error: 'Add a Mistral API key in settings or on the server.' });
    }

    const { dialect } = req.body as { dialect?: string };
    const payload = await callMistral(apiKey, {
      model: defaultModel,
      temperature: 0.8,
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
    });

    const fact = extractJsonObject(extractContent(payload));
    res.json({ fact });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.listen(port, () => {
  console.log(`Amo API listening on http://localhost:${port}`);
});
