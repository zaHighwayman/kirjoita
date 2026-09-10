/* Testit kuvalitteroinnille ja kuvatuelle. */
import { transcribeEssay, transcriptionWarnings, annotationsToComment, MAX_IMAGE_EDGE } from '../src/vision.js';
import { toParts, resolveProvider, hasVision, PROVIDERS } from '../src/provider.js';

const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || '' });

const IMG = { mime: 'image/jpeg', data: 'AAAA' };
const CFG_GEMINI = { groq: { key: 'g' }, gemini: { key: 'gm' } };
const CFG_GROQ = { groq: { key: 'g' } };

export async function run() {
  /* ── Osaluettelo ── */
  ok('parts: merkkijono → yksi tekstiosa',
     toParts('hei').length === 1 && toParts('hei')[0].type === 'text');
  ok('parts: taulukko säilyy', toParts([{type:'image',mime:'image/jpeg',data:'x'}])[0].type === 'image');

  /* ── Kuvatuki tarjoajissa ── */
  ok('vision: Groqilla on multimodaalinen malli', !!PROVIDERS.groq.visionModel);
  ok('vision: Gemini tukee kuvia', !!PROVIDERS.gemini.visionModel);
  ok('vision: rooli suosii Geminiä', resolveProvider('vision', CFG_GEMINI).provider.id === 'gemini');
  ok('vision: rooli käyttää kuvamallia eikä tekstimallia',
     resolveProvider('vision', CFG_GROQ).model === PROVIDERS.groq.visionModel,
     resolveProvider('vision', CFG_GROQ).model);
  ok('vision: tekstirooli käyttää käyttäjän mallia',
     resolveProvider('generation', { groq: { key:'g', model:'oma/malli' } }).model === 'oma/malli');
  ok('vision: ilman avaimia ei kuvatukea', hasVision({}) === false);
  ok('vision: avaimella on kuvatuki', hasVision(CFG_GROQ) === true);

  /* ── Runko: kuva menee oikeassa muodossa ── */
  let captured = null;
  const capture = async (messages, opts) => { captured = { messages, opts }; return {
    text: 'Monet ihmiset ajattelee näin.', annotations: [], teacherSummary: '', gradeSeen: '',
    criterionPointsSeen: [], legible: true, uncertainSpans: [] }; };
  await transcribeEssay([IMG, IMG], CFG_GEMINI, capture);
  ok('kutsu: rooli on vision', captured.opts.role === 'vision');
  ok('kutsu: lämpötila 0', captured.opts.temperature === 0);
  const parts = captured.messages[1].content;
  ok('kutsu: teksti ensin, kuvat perässä',
     parts[0].type === 'text' && parts[1].type === 'image' && parts[2].type === 'image');
  ok('kutsu: sivumäärä kerrotaan', /2 sivua/.test(parts[0].text));

  /* ── Sanatarkkuus on kehotteen ydin ── */
  const sys = captured.messages[0].content;
  ok('kehote: kieltää virheiden korjaamisen', /ÄLÄ korjaa kirjoitusvirheitä/.test(sys));
  ok('kehote: kieltää tyylin parantamisen', /ÄLÄ paranna sanavalintoja/.test(sys));
  ok('kehote: antaa konkreettisen esimerkin', /monet ihmiset ajattelee/.test(sys));
  ok('kehote: sanoo miksi', /Korjattu litterointi on hyödytön/.test(sys));
  ok('kehote: erottaa opettajan merkinnät', /opettajan merkinnät/i.test(sys));
  ok('kehote: kieltää arvaamisen', /Älä arvaa/.test(sys));

  /* ── Tulos ── */
  const t = await transcribeEssay([IMG], CFG_GEMINI, async () => ({
    text: 'Monet ihmiset ajattelee näin. Se on [epäselvä] asia.',
    annotations: [{ quote:'ajattelee', note:'ajattelevat', kind:'korjaus' },
                  { quote:'', note:'', kind:'muu' }],
    teacherSummary: 'Hyvä rakenne, kieliasussa huolimattomuutta.',
    gradeSeen: '42/60',
    criterionPointsSeen: [{ name:'Kieli ja ilmaisu', points:30 }, { name:'x', points:'ei luku' }],
    legible: true, uncertainSpans: ['toinen kappale'],
  }));
  ok('tulos: teksti säilyy virheineen', /ajattelee/.test(t.text) && !/ajattelevat/.test(t.text));
  ok('tulos: tyhjä merkintä pudotetaan', t.annotations.length === 1);
  ok('tulos: pistemäärä poimitaan', t.criterionPointsSeen.length === 1 && t.criterionPointsSeen[0].points === 30);
  ok('tulos: arvosana talteen', t.gradeSeen === '42/60');
  ok('tulos: aina tarkistettava', t.needsReview === true);
  ok('tulos: sivumäärä kirjataan', t.pages === 1);

  /* ── Varoitukset ── */
  const w = transcriptionWarnings(t);
  ok('varoitus: epävarmat kohdat mainitaan', w.some(x => /epävarmaksi/.test(x)), w.join(' | '));
  ok('varoitus: [epäselvä] havaitaan', w.some(x => /epäselvä/.test(x)));
  ok('varoitus: aina muistutus korjaamisriskistä',
     w.some(x => /korjaa herkästi kirjoitusvirheitä/.test(x)));
  ok('varoitus: lukukelvoton kuva mainitaan',
     transcriptionWarnings({ ...t, legible: false }).some(x => /kunnolla luettavissa/.test(x)),
     transcriptionWarnings({ ...t, legible: false }).join(' | '));
  ok('varoitus: liian lyhyt teksti mainitaan',
     transcriptionWarnings({ text:'lyhyt', legible:true, uncertainSpans:[] }).some(x => /hyvin lyhyt/.test(x)));

  /* ── Merkinnät kommentiksi ── */
  const c = annotationsToComment(t);
  ok('kommentti: sisältää loppukommentin', /Hyvä rakenne/.test(c));
  ok('kommentti: sisältää merkinnät lainauksineen', /"ajattelee" → ajattelevat/.test(c), c);

  /* ── Virhetilanteet ── */
  try { await transcribeEssay([], CFG_GEMINI, capture); ok('virhe: tyhjä kuvalista', false); }
  catch (e) { ok('virhe: tyhjä kuvalista kerrotaan', /Ei kuvia/.test(e.message)); }
  try { await transcribeEssay([IMG], {}, capture); ok('virhe: ilman avainta', false); }
  catch (e) { ok('virhe: puuttuva kuvatuki ohjaa asetuksiin', /Asetuksista/.test(e.message), e.message); }

  ok('koko: skaalausraja järkevä käsialalle', MAX_IMAGE_EDGE >= 1200 && MAX_IMAGE_EDGE <= 2400);
  return results;
}
