/* Testit tarjoaja-adapterille ja vilpinestolle. */
import { callJSON, resolveProvider, resetProviderState, salvageJSON, llmErrorMessage,
         PROVIDERS, LlmError } from '../src/provider.js';
import { checkMetricGate, confirmNotGamed, verifySkillAttempt, verifyAll,
         METRIC_GATES, GATED_SKILLS, isGated } from '../src/antigaming.js';
import { analyzeText } from '../src/metrics.js';

const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || '' });

const CFG = { groq: { key: 'gsk_test', model: 'openai/gpt-oss-120b' } };
const CFG_BOTH = { groq: { key: 'g' }, gemini: { key: 'gm' } };

let queue = [], calls = [];
function mockFetch() {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    const n = queue.shift();
    if (!n) throw new Error('MOCK QUEUE EMPTY');
    if (n.networkError) throw new TypeError('Failed to fetch');
    const gemini = String(url).includes('generativelanguage');
    return {
      ok: n.status === 200, status: n.status,
      headers: { get: k => (n.headers || {})[k] || null },
      json: async () => n.status !== 200 ? { error: { message: n.detail || '' } }
        : gemini
          ? { candidates: [{ finishReason: n.finish === 'length' ? 'MAX_TOKENS' : 'STOP',
                             content: { parts: [{ text: n.content }] } }] }
          : { choices: [{ finish_reason: n.finish || 'stop', message: { content: n.content } }] },
    };
  };
}
const reset = q => { queue = q; calls = []; resetProviderState(); };
const GOOD = '{"ok":true}';

export async function run() {
  const realFetch = globalThis.fetch;
  mockFetch();

  /* ── Roolinvalinta ── */
  ok('rooli: analysis suosii Geminiä', resolveProvider('analysis', CFG_BOTH).provider.id === 'gemini');
  ok('rooli: generation suosii Groqia', resolveProvider('generation', CFG_BOTH).provider.id === 'groq');
  ok('rooli: putoaa Groqiin ilman Gemini-avainta', resolveProvider('analysis', CFG).provider.id === 'groq');
  ok('rooli: ei avaimia → null', resolveProvider('analysis', {}) === null);
  ok('rooli: oletusmalli täydentyy', resolveProvider('generation', { groq: { key: 'k' } }).model === PROVIDERS.groq.defaultModel);

  /* ── Perusreitti ── */
  reset([{ status: 200, content: GOOD }]);
  ok('kutsu: parsii JSONin', (await callJSON([{role:'user',content:'JSON'}], { config: CFG })).ok === true);
  ok('kutsu: json-tila päällä', calls[0].body.response_format.type === 'json_object');
  ok('kutsu: avain otsakkeessa', /Bearer gsk_test/.test(calls[0].headers.Authorization));

  reset([{ status: 200, content: GOOD }]);
  await callJSON([{role:'user',content:'x'}], { config: CFG, reasoningEffort: 'low' });
  ok('kutsu: reasoning_effort välittyy', calls[0].body.reasoning_effort === 'low');

  /* ── Gemini-runko ── */
  reset([{ status: 200, content: GOOD }]);
  const g = await callJSON([{role:'system',content:'S'},{role:'user',content:'U'}],
                           { config: CFG_BOTH, role: 'analysis' });
  ok('gemini: parsii vastauksen', g.ok === true);
  ok('gemini: avain URLissa eikä otsakkeessa',
     /key=gm/.test(calls[0].url) && !calls[0].headers.Authorization);
  ok('gemini: system erotettu contentsista',
     calls[0].body.systemInstruction.parts[0].text === 'S' && calls[0].body.contents.length === 1);
  ok('gemini: json-mime asetettu', calls[0].body.generationConfig.responseMimeType === 'application/json');

  /* ── Uusintayritykset ── */
  reset([{ status: 200, finish: 'length', content: '{"a":' }, { status: 200, content: GOOD }]);
  ok('retry: katkennut korjaantuu', (await callJSON([{role:'user',content:'x'}], { config: CFG, maxTokens: 4000 })).ok);
  ok('retry: token-katto nousi', calls[1].body.max_tokens > calls[0].body.max_tokens,
     calls[0].body.max_tokens + '→' + calls[1].body.max_tokens);

  reset([{ status: 200, content: 'ei json' }, { status: 200, content: GOOD }]);
  await callJSON([{role:'user',content:'x'}], { config: CFG, temperature: 0.7 });
  ok('retry: lämpötila laski', calls[1].body.temperature < calls[0].body.temperature);

  reset([{ status: 200, content: 'x' }, { status: 200, content: 'y' }, { status: 200, content: 'z' }]);
  try { await callJSON([{role:'user',content:'x'}], { config: CFG }); ok('retry: luovuttaa', false); }
  catch (e) { ok('retry: luovuttaa suomeksi', /kelvollista vastausta/.test(e.message), e.message);
              ok('retry: tasan 3 kutsua', calls.length === 3, 'n=' + calls.length); }

  reset([{ status: 429, detail: 'rate', headers: { 'retry-after': '0.05' } }, { status: 200, content: GOOD }]);
  ok('retry: 429 toipuu', (await callJSON([{role:'user',content:'x'}], { config: CFG })).ok);

  reset([{ status: 400, detail: 'response_format is not supported' }, { status: 200, content: GOOD }]);
  await callJSON([{role:'user',content:'x'}], { config: CFG });
  ok('retry: tukematon parametri pudotetaan', calls[1].body.response_format === undefined);

  /* ── Virheet ── */
  for (const [st, det, re] of [[401,'bad key',/avain ei kelpaa/],[404,'decommissioned',/ei ole enää saatavilla/],
                               [503,'down',/häiriö/],[0,'',/verkkoyhteys/i]]) {
    reset([st === 0 ? { networkError: true } : { status: st, detail: det }]);
    try { await callJSON([{role:'user',content:'x'}], { config: CFG }); ok('virhe ' + st, false); }
    catch (e) { ok('virhe ' + st + ': suomenkielinen', re.test(e.message), e.message); }
  }
  reset([]);
  try { await callJSON([{role:'user',content:'x'}], { config: {} }); ok('virhe: puuttuva avain', false); }
  catch (e) { ok('virhe: puuttuva avain kertoo mitä tehdä', /avain puuttuu/i.test(e.message), e.message); }

  ok('salvage: proosan seasta', salvageJSON('Tässä: {"a":1} kiitos').a === 1);
  ok('salvage: taulukko', Array.isArray(salvageJSON('joo [1,2,3] loppu')));
  ok('salvage: roska → null', salvageJSON('ei mitään') === null);

  /* ── Vilpinesto: mittariportti ── */
  ok('portti: portitetut taidot listattu', GATED_SKILLS.length >= 6 && isGated('kie-virkerytmi'));
  ok('portti: portittamaton läpäisee suoraan', checkMetricGate('arg-perustelu', 'mitä vain').gated === false);

  const flat = 'Kissa istui matolla rauhassa. Koira nukkui sohvalla hiljaa. Lintu lauloi puussa kauniisti. Hiiri juoksi lattialla nopeasti.';
  ok('portti: tasainen rytmi ei läpäise', checkMetricGate('kie-virkerytmi', flat).pass === false);
  const varied = 'Hän tuli. Odotus oli ollut pitkä ja raskas, sillä vastausta oli jouduttu odottamaan viikkoja ilman mitään tietoa siitä milloin se saapuisi. Sitten kaikki muuttui. Ovi aukesi hitaasti.';
  ok('portti: vaihteleva rytmi läpäisee', checkMetricGate('kie-virkerytmi', varied).pass === true,
     'sd=' + checkMetricGate('kie-virkerytmi', varied).value);
  ok('portti: hylkäys kertoo syyn suomeksi',
     /keskihajonta|virkkeiden/.test(checkMetricGate('kie-virkerytmi', flat).reason || ''),
     checkMetricGate('kie-virkerytmi', flat).reason);
  ok('portti: nominalisaatiotykitys ei läpäise ylärajaa',
     METRIC_GATES['san-nominalisaatio'].check({ nominalisationDensity: 120 }).pass === false);
  ok('portti: nominalisaation alaraja',
     METRIC_GATES['san-nominalisaatio'].check({ nominalisationDensity: 2 }).pass === false);
  ok('portti: nominalisaation kaista',
     METRIC_GATES['san-nominalisaatio'].check({ nominalisationDensity: 25 }).pass === true);
  ok('portti: liian pitkä virke hylätään',
     METRIC_GATES['kie-virkerakenne'].check({ maxSentenceLength: 60 }).pass === false);

  /* ── Vilpinesto: kaksivaiheisuus ── */
  const fakeYes = async () => ({ genuine: true, reason: '' });
  const fakeNo  = async () => ({ genuine: false, reason: 'yksi keinotekoisen pitkä virke' });

  let v = await verifySkillAttempt('kie-virkerytmi', flat, 1, CFG, fakeYes);
  ok('portti: mittari kiinni → hylätty ennen mallia', v.passed === false && v.stage === 'mittari' && v.result === 0);
  ok('portti: mittarihylkäys selittää', !!v.explanation);

  v = await verifySkillAttempt('kie-virkerytmi', varied, 1, CFG, fakeNo);
  ok('portti: mittari auki + malli hylkää → hylätty', v.passed === false && v.stage === 'tarkistus' && v.result === 0);
  ok('portti: mallihylkäys välittää perustelun', /keinotekoisen pitkä/.test(v.explanation), v.explanation);

  v = await verifySkillAttempt('kie-virkerytmi', varied, 1, CFG, fakeYes);
  ok('portti: molemmat läpi → pisteytyy', v.passed === true && v.result === 1 && v.stage === 'läpi');

  v = await verifySkillAttempt('arg-perustelu', flat, 0.8, CFG, fakeNo);
  ok('portti: portittamaton ei kutsu mallia', v.passed === true && v.result === 0.8);

  const boom = async () => { throw new LlmError('verkko', 0); };
  v = await verifySkillAttempt('kie-virkerytmi', varied, 1, CFG, boom);
  ok('portti: verkkovirhe ei rankaise (fail-open)', v.passed === true && v.result === 1);
  ok('portti: fail-open merkitään', v.checked === false);

  const all = await verifyAll([['kie-virkerytmi', 1], ['arg-perustelu', 1]], flat, CFG, fakeYes);
  ok('verifyAll: portitettu hylätään, muu säilyy',
     all.find(x => x.skillId === 'kie-virkerytmi').result === 0 &&
     all.find(x => x.skillId === 'arg-perustelu').result === 1);

  // oikea kutsurunko
  reset([{ status: 200, content: '{"genuine":false,"reason":"keinotekoista"}' }]);
  const c = await confirmNotGamed('kie-virkerytmi', varied, CFG);
  ok('tarkistus: käyttää oikeaa tarjoajaa ja palauttaa hylyn', c.genuine === false && /keinotekoista/.test(c.reason));
  ok('tarkistus: lämpötila 0', calls[0].body.temperature === 0);

  globalThis.fetch = realFetch;
  return results;
}
