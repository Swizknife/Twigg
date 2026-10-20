// One interface over two free AI backends:
//   - Gemini (free API key from aistudio.google.com) — fast, long context
//   - Ollama (local, private, offline) — runs on your CPU
//
// Messages use a simple shared shape: [{ role: 'user' | 'assistant', content: '...' }]

import { getSettings } from './settings.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class LLMError extends Error {
  constructor(message, { provider, status, hint } = {}) {
    super(message);
    this.name = 'LLMError';
    this.provider = provider;
    this.status = status;
    this.hint = hint;
  }
}

/** Which providers to try, in order. `forced` overrides the user's setting. */
function providerOrder(settings, forced) {
  const choice = forced || settings.provider;
  if (choice === 'gemini') return ['gemini'];
  if (choice === 'ollama') return ['ollama'];
  return settings.geminiKey ? ['gemini', 'ollama'] : ['ollama'];
}

/** The provider that will be tried first — used to size how much page text to send. */
export async function primaryProvider() {
  return providerOrder(await getSettings())[0];
}

/**
 * Stream a reply as text chunks.
 * opts: { system, messages, json, temperature, signal, provider, onProvider }
 * In 'auto' mode, falls back to Ollama if Gemini fails before producing any text.
 */
export async function* stream(opts) {
  const settings = await getSettings();
  const errors = [];
  for (const provider of providerOrder(settings, opts.provider)) {
    let started = false;
    try {
      const chunks = provider === 'gemini' ? geminiStream(settings, opts) : ollamaStream(settings, opts);
      for await (const chunk of chunks) {
        if (!started) opts.onProvider?.(provider);
        started = true;
        yield chunk;
      }
      return;
    } catch (err) {
      if (started || err.name === 'AbortError') throw err;
      errors.push(err);
    }
  }
  throw explainFailure(errors, settings, opts.provider);
}

const NAMES = { gemini: 'Gemini', ollama: 'Ollama' };

/**
 * When every provider failed, report the FIRST (real) problem — not just the fallback's.
 * Before this, a bad Gemini key surfaced only as "Ollama refused the extension (403)".
 */
export function explainFailure(errors, settings, forced) {
  const [first, ...rest] = errors;
  if (!first) return new LLMError('No AI is set up', { hint: 'Add a free Gemini key in Twigg settings (⚙).' });
  // auto mode without a key never even tried Gemini — say so, because that is the thing to fix
  if (!forced && settings.provider === 'auto' && !settings.geminiKey && first.provider === 'ollama') {
    return new LLMError(`No Gemini API key is saved in Twigg, so it tried your local Ollama — which failed: ${first.message}`, {
      provider: 'ollama',
      status: first.status,
      hint: 'Paste your Gemini key in Twigg settings (⚙) and press Test Gemini. (Or, to use Ollama, follow the README’s Ollama setup.)',
    });
  }
  if (!rest.length) return first;
  const also = rest.map((e) => `${NAMES[e.provider] || e.provider}: ${e.message}`).join('; ');
  return new LLMError(`${NAMES[first.provider] || first.provider}: ${first.message} (the fallback also failed — ${also})`, {
    provider: first.provider,
    status: first.status,
    hint: first.hint,
  });
}

/** Full reply as one string. */
export async function complete(opts) {
  let text = '';
  for await (const chunk of stream(opts)) text += chunk;
  return text;
}

/** Reply parsed as JSON (the model is asked for JSON output). */
export async function completeJSON(opts) {
  const text = await complete({ temperature: 0.2, ...opts, json: true });
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new LLMError('The AI returned invalid JSON', { hint: 'Retry, or switch model in settings.' });
  }
}

export async function testConnection(provider) {
  const reply = await complete({
    provider,
    messages: [{ role: 'user', content: 'Reply with exactly: Twigg OK' }],
    temperature: 0,
  });
  return reply.trim();
}

export async function listModels(provider) {
  const settings = await getSettings();
  if (provider === 'gemini') {
    if (!settings.geminiKey) throw new LLMError('Add your Gemini API key first', { provider });
    const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': settings.geminiKey },
    });
    if (!res.ok) throw await geminiError(res);
    const { models = [] } = await res.json();
    return models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  }
  const res = await ollamaFetch(settings, '/api/tags');
  const { models = [] } = await res.json();
  return models.map((m) => m.name);
}

// ---------- Gemini ----------

// Google retires and overloads models often (e.g. gemini-2.5-flash was retired for new keys).
// If the chosen model can't answer, try these before giving up on Gemini.
export const GEMINI_FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
const FIRST_BYTE_TIMEOUT_MS = 25000;
/** Errors another model might not have: retired/not found, overloaded, rate-limited, server error, no answer. */
const tryAnotherModel = (err) => [404, 429, 500, 503, 'timeout'].includes(err.status);

async function* geminiStream(settings, opts) {
  if (!settings.geminiKey) {
    throw new LLMError('No Gemini API key set', {
      provider: 'gemini',
      hint: 'Add a free key in Twigg settings (aistudio.google.com/apikey).',
    });
  }
  const chosen = String(settings.geminiModel || '').replace(/^models\//, '');
  const models = [...new Set([chosen, ...GEMINI_FALLBACK_MODELS].filter(Boolean))];
  let lastError;
  for (const model of models) {
    let started = false;
    try {
      for await (const chunk of geminiModelStream(settings, opts, model)) {
        if (!started) opts.onModel?.(model);
        started = true;
        yield chunk;
      }
      return;
    } catch (err) {
      if (started || opts.signal?.aborted || !tryAnotherModel(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

async function* geminiModelStream(settings, { system, messages, json, temperature = 0.7, signal }, model) {
  const body = {
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { temperature, ...(json && { responseMimeType: 'application/json' }) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  // stop waiting if the model doesn't even start answering (overloaded models can hang for minutes)
  const waiting = new AbortController();
  const timer = setTimeout(() => waiting.abort(), FIRST_BYTE_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.geminiKey },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, waiting.signal]) : waiting.signal,
    });
  } catch (err) {
    if (waiting.signal.aborted && !signal?.aborted) {
      throw new LLMError(`Gemini model ${model} did not answer in ${FIRST_BYTE_TIMEOUT_MS / 1000} s`, { provider: 'gemini', status: 'timeout', hint: 'Google may be busy. Try again in a minute.' });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw await geminiError(res);

  for await (const line of readLines(res.body)) {
    if (!line.startsWith('data:')) continue;
    const data = JSON.parse(line.slice(5));
    if (data.promptFeedback?.blockReason) {
      throw new LLMError(`Gemini blocked the request (${data.promptFeedback.blockReason})`, { provider: 'gemini' });
    }
    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
    if (text) yield text;
  }
}

async function geminiError(res) {
  let message = `Gemini error ${res.status}`;
  try {
    message = (await res.json()).error?.message || message;
  } catch {}
  const hints = {
    400: 'Check that your API key is correct.',
    403: 'Your API key is not allowed to use this model.',
    404: 'Model not found — use "Load models" in settings to pick one.',
    429: 'Free-tier rate limit reached. Wait a minute, or switch to Ollama.',
    503: 'Google says this model is busy right now. Try again in a minute.',
  };
  return new LLMError(message, { provider: 'gemini', status: res.status, hint: hints[res.status] });
}

// ---------- Ollama ----------

async function ollamaFetch(settings, path, init) {
  let res;
  try {
    res = await fetch(settings.ollamaUrl.replace(/\/$/, '') + path, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new LLMError('Could not reach Ollama', {
      provider: 'ollama',
      hint: 'Start the Ollama app, then retry.',
    });
  }
  if (res.status === 403) {
    throw new LLMError('Ollama refused the extension (403)', {
      provider: 'ollama',
      status: 403,
      hint: 'Set OLLAMA_ORIGINS to chrome-extension://* and restart Ollama (see README).',
    });
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    const notFound = /not found/i.test(detail);
    throw new LLMError(`Ollama error ${res.status}: ${detail}`, {
      provider: 'ollama',
      status: res.status,
      hint: notFound ? `Run: ollama pull ${settings.ollamaModel}` : undefined,
    });
  }
  return res;
}

async function* ollamaStream(settings, { system, messages, json, temperature = 0.7, signal }) {
  const res = await ollamaFetch(settings, '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.ollamaModel,
      messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
      stream: true,
      ...(json && { format: 'json' }),
      options: { temperature, num_ctx: 8192 },
    }),
    signal,
  });
  for await (const line of readLines(res.body)) {
    if (!line.trim()) continue;
    const data = JSON.parse(line);
    if (data.error) throw new LLMError(`Ollama: ${data.error}`, { provider: 'ollama' });
    if (data.message?.content) yield data.message.content;
  }
}

// ---------- helpers ----------

async function* readLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) yield line.replace(/\r$/, '');
  }
  if (buffer) yield buffer;
}
