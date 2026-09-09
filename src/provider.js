/* Palveluntarjoaja-adapteri. Yksi ohut kerros, tarjoaja valitaan konfiguraatiosta.
 *
 * Ilmaiset tasot muuttuvat ilman varoitusta, joten mihinkään tarjoajaan ei sidota:
 * roolit (analysis / generation / classification) kartoitetaan tarjoajiin, ja
 * puuttuva avain pudottaa roolin takaisin oletustarjoajalle.
 *
 * Kaikki uusintayrityslogiikka on täällä: katkennut vastaus, epäkelpo JSON,
 * käyttöraja ja mallin hylkäämät parametrit.
 */

export const TOKEN_CEILING = 16000;

export const PROVIDERS = {
  groq: {
    id: 'groq', label: 'Groq', style: 'openai',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'openai/gpt-oss-120b',
    keysUrl: 'https://console.groq.com/keys',
    // Groqin läpimeno on tiukka: pitkä essee + rubriikki ei mahdu yhteen pyyntöön.
    maxContextHint: 6000,
  },
  gemini: {
    id: 'gemini', label: 'Google Gemini', style: 'gemini',
    url: (model, key) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    defaultModel: 'gemini-2.0-flash',
    keysUrl: 'https://aistudio.google.com/apikey',
    maxContextHint: 1000000,
  },
};

/** Rooli → haluttu tarjoaja. Pitkä konteksti Geminille, nopeat askeleet Groqille. */
export const ROLE_PREFERENCE = {
  analysis: ['gemini', 'groq'],
  generation: ['groq', 'gemini'],
  classification: ['groq', 'gemini'],
  check: ['groq', 'gemini'],
};

export class LlmError extends Error {
  constructor(msg, status) { super(msg); this.name = 'LlmError'; this.status = status; }
}

const unsupportedParams = {};
const skipSet = k => unsupportedParams[k] || (unsupportedParams[k] = new Set());
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Nollaa muistetut tuentapuutteet — testejä ja mallin vaihtoa varten. */
export function resetProviderState() { for (const k in unsupportedParams) delete unsupportedParams[k]; }

/**
 * Valitsee roolille tarjoajan sen mukaan, mihin on avain.
 * @param {object} config { groq:{key,model}, gemini:{key,model} }
 */
export function resolveProvider(role, config) {
  const order = ROLE_PREFERENCE[role] || ROLE_PREFERENCE.generation;
  for (const id of order) {
    const c = config && config[id];
    if (c && c.key) return { provider: PROVIDERS[id], model: c.model || PROVIDERS[id].defaultModel, key: c.key };
  }
  return null;
}

export function llmErrorMessage(status, detail, modelName) {
  const d = (detail || '').toLowerCase();
  if (status === 0)   return 'Yhteyttä tekoälypalveluun ei saatu. Tarkista verkkoyhteys ja yritä uudelleen.';
  if (status === 401 || status === 403) return 'API-avain ei kelpaa. Tarkista avain Asetuksista.';
  if (status === 429) return 'Käyttöraja tuli täyteen. Odota hetki ja yritä uudelleen.';
  if (status === 404 || d.includes('does not exist') || d.includes('model_not_found') || d.includes('decommissioned'))
    return `Mallia "${modelName}" ei ole enää saatavilla. Vaihda malli Asetuksista.`;
  if (status === 413 || d.includes('too large') || d.includes('context_length'))
    return 'Teksti on liian pitkä mallille. Lyhennä tekstiä ja yritä uudelleen.';
  if (status >= 500) return 'Tekoälypalvelussa on häiriö. Yritä hetken kuluttua uudelleen.';
  return detail
    ? `Pyyntö hylättiin. Yritä uudelleen tai vaihda malli Asetuksista. (tekninen syy: ${detail})`
    : `Pyyntö hylättiin (HTTP ${status}). Yritä uudelleen tai vaihda malli Asetuksista.`;
}

/* ── Yksi HTTP-kutsu, tarjoajakohtainen runko ── */
async function request({ provider, model, key, messages, maxTokens, temperature, jsonMode, reasoningEffort }) {
  const skip = skipSet(provider.id + ':' + model);
  let url, body, headers = { 'Content-Type': 'application/json' };

  if (provider.style === 'gemini') {
    url = provider.url(model, key);
    const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const rest = messages.filter(m => m.role !== 'system');
    body = {
      contents: rest.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    if (jsonMode && !skip.has('response_format')) body.generationConfig.responseMimeType = 'application/json';
  } else {
    url = provider.url;
    headers.Authorization = `Bearer ${key}`;
    body = { model, messages, temperature, max_tokens: maxTokens };
    if (jsonMode && !skip.has('response_format')) body.response_format = { type: 'json_object' };
    if (reasoningEffort && !skip.has('reasoning_effort')) body.reasoning_effort = reasoningEffort;
  }

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new LlmError(llmErrorMessage(0, '', model), 0);
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = (j.error && j.error.message) || ''; } catch {}
    const d = detail.toLowerCase();
    if (res.status === 400) {
      let dropped = false;
      if (jsonMode && (d.includes('response_format') || d.includes('json_object') || d.includes('json mode') || d.includes('responsemimetype'))) {
        skip.add('response_format'); dropped = true;
      }
      if (reasoningEffort && d.includes('reasoning')) { skip.add('reasoning_effort'); dropped = true; }
      if (dropped) { const e = new LlmError('param-not-supported', 400); e.retryWithoutParam = true; throw e; }
    }
    const err = new LlmError(llmErrorMessage(res.status, detail, model), res.status);
    if (res.status === 429) err.retryAfter = parseFloat(res.headers.get('retry-after') || '') || null;
    throw err;
  }

  const data = await res.json();
  let content = '', finishReason = '';
  if (provider.style === 'gemini') {
    const cand = (data.candidates && data.candidates[0]) || {};
    content = ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
    finishReason = cand.finishReason === 'MAX_TOKENS' ? 'length' : (cand.finishReason || '').toLowerCase();
  } else {
    const choice = (data.choices && data.choices[0]) || {};
    content = (choice.message && choice.message.content) || '';
    finishReason = choice.finish_reason || '';
  }
  content = String(content).replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  return { content, finishReason };
}

/** Malli saattoi ympäröidä JSONin selitystekstillä. */
export function salvageJSON(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  const c = text.indexOf('['), d = text.lastIndexOf(']');
  if (c >= 0 && d > c) { try { return JSON.parse(text.slice(c, d + 1)); } catch {} }
  return null;
}

/**
 * Hakee JSON-vastauksen. Kaksi uusintayritystä ennen kuin virhe näytetään.
 * Katkennut → suurempi token-katto; epäkelpo JSON → matalampi lämpötila.
 */
export async function callJSON(messages, opts = {}) {
  const sel = opts.provider
    ? { provider: PROVIDERS[opts.provider], model: opts.model || PROVIDERS[opts.provider].defaultModel, key: opts.key }
    : resolveProvider(opts.role || 'generation', opts.config);
  if (!sel || !sel.key) throw new LlmError('API-avain puuttuu. Lisää avain Asetuksista.', 0);

  const MAX = 3;
  const base = messages;
  let tokens = opts.maxTokens || 4000;
  let temperature = opts.temperature != null ? opts.temperature : 0.5;
  const reasoningEffort = opts.reasoningEffort || null;
  let problem = '', paramRetries = 0;

  for (let attempt = 1; attempt <= MAX; attempt++) {
    const msgs = problem
      ? base.concat([{ role: 'system', content: problem === 'katkesi'
          ? 'Edellinen vastauksesi katkesi kesken. Vastaa lyhyemmin mutta palauta ehdottomasti täydellinen, sulkeutuva JSON.'
          : 'Edellinen vastauksesi ei ollut kelvollista JSONia. Palauta VAIN yksi validi JSON-arvo ilman selityksiä.' }])
      : base;
    let out;
    try {
      out = await request({ ...sel, messages: msgs, maxTokens: tokens, temperature, jsonMode: true, reasoningEffort });
    } catch (e) {
      if (e.retryWithoutParam && paramRetries < 2) { paramRetries++; attempt--; continue; }
      if (e.status === 429 && attempt < MAX) {
        await sleep(Math.min(e.retryAfter ? e.retryAfter * 1000 : 1500 * 2 ** (attempt - 1), 20000));
        continue;
      }
      throw e;
    }
    if (out.finishReason === 'length' || !out.content) {
      problem = 'katkesi'; tokens = Math.min(Math.round(tokens * 1.6), TOKEN_CEILING); continue;
    }
    try { return JSON.parse(out.content); }
    catch {
      const s = salvageJSON(out.content);
      if (s) return s;
      problem = 'ei-json';
      tokens = Math.min(Math.round(tokens * 1.3), TOKEN_CEILING);
      temperature = Math.max(0, temperature - 0.2);
    }
  }
  throw new LlmError(problem === 'katkesi'
    ? 'Tekoälyn vastaus katkesi kesken kolmella yrityksellä. Yritä uudelleen tai vaihda malli Asetuksista.'
    : 'Tekoäly ei palauttanut kelvollista vastausta kolmella yrityksellä. Yritä uudelleen tai vaihda malli Asetuksista.', 0);
}
