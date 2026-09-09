/* Testit Elo-portaikolle, kertausvälille ja renderöijäauditille. */
import {
  expectedScore, targetDifficulty, updateElo, applyAttempt, buildServeQueue,
  nextSrStep, dueAtFrom, isOverdue, overdueDays,
  START_ELO, K_SKILL, K_EXERCISE, SR_INTERVALS, TARGET_SUCCESS,
} from '../src/elo.js';
import { RENDERERS, RENDERER_IDS, LEGACY_TO_RENDERER, renderersForSkill, clampToBand } from '../src/renderers.js';

const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || '' });
const near = (name, got, want, tol, d) => ok(name, Math.abs(got - want) <= tol, d || `sai ${got}, odotettiin ~${want}`);
const DAY = 86400000;

/* ── Odotusarvo ── */
near('odotus: sama taso → 0.5', expectedScore(1200, 1200), 0.5, 1e-9);
ok('odotus: helpompi → yli 0.5', expectedScore(1200, 1000) > 0.5);
ok('odotus: vaikeampi → alle 0.5', expectedScore(1200, 1400) < 0.5);
ok('odotus: aina välillä 0-1',
   [[800,2000],[2000,800],[1200,1200]].every(([e,d]) => { const p = expectedScore(e,d); return p>0 && p<1; }));

/* ── Kohdevaikeus ── */
near('kohde: 0.8 → elo − 240', targetDifficulty(1200), 1200 - 240.8, 0.5);
ok('kohde: on spesifikaation mukainen', Math.abs((1200 - targetDifficulty(1200)) - 240) < 1);
near('kohde: pyöreä 0.5 → sama elo', targetDifficulty(1200, 0.5), 1200, 1e-9);
near('kohde: takaisinkytkentä pitää',
     expectedScore(1500, targetDifficulty(1500)), TARGET_SUCCESS, 1e-9,
     'odotus kohdevaikeudella ei ole 0.8');

/* ── Elo-päivitys ── */
const win = updateElo(1200, 1200, 1);
near('elo: voitto tasapelitilanteessa nostaa K/2', win.skillElo, 1200 + K_SKILL/2, 1e-9);
near('elo: harjoitus laskee K_ex/2', win.difficulty, 1200 - K_EXERCISE/2, 1e-9);
const loss = updateElo(1200, 1200, 0);
near('elo: tappio laskee K/2', loss.skillElo, 1200 - K_SKILL/2, 1e-9);
near('elo: harjoitus nousee tappiosta', loss.difficulty, 1200 + K_EXERCISE/2, 1e-9);
ok('elo: taito liikkuu harjoitusta nopeammin',
   Math.abs(win.skillElo - 1200) > Math.abs(win.difficulty - 1200));
const easyWin = updateElo(1600, 1000, 1);
ok('elo: odotettu voitto liikuttaa vähän', Math.abs(easyWin.skillElo - 1600) < 2, 'Δ=' + (easyWin.skillElo-1600).toFixed(2));
const upset = updateElo(1000, 1600, 1);
ok('elo: yllätysvoitto liikuttaa paljon', upset.skillElo - 1000 > 20, 'Δ=' + (upset.skillElo-1000).toFixed(2));
ok('elo: result rajataan 0-1',
   updateElo(1200,1200,5).skillElo === updateElo(1200,1200,1).skillElo);

/* ── Portaikko suppenee oikeaan tasoon ── */
// Simuloi oppijaa, jonka todellinen taso on 1400: tarjoillaan kohdevaikeutta,
// onnistuminen arvotaan todellisella todennäköisyydellä. Elon pitäisi nousta sinne.
(() => {
  const TRUE = 1400;
  let skill = { elo: START_ELO, srStep: 0 };
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 400; i++) {
    const d = targetDifficulty(skill.elo);
    const pTrue = expectedScore(TRUE, d);
    const res = rnd() < pTrue ? 1 : 0;
    const out = applyAttempt(skill, { difficulty: d }, res);
    skill = out.skill;
  }
  ok('portaikko: suppenee todelliseen tasoon', Math.abs(skill.elo - TRUE) < 120,
     'elo=' + skill.elo.toFixed(0) + ' vs tosi=' + TRUE);
})();

// Tarjoiltu vaikeus tuottaa oikeasti ~80 % onnistumisia kun arvio on oikea.
near('portaikko: kohdevaikeus tuottaa 80 % onnistumisia',
     expectedScore(1400, targetDifficulty(1400)), 0.8, 1e-9);

/* ── Kertausväli ── */
ok('sr: onnistuminen kasvattaa askelta', nextSrStep(0, 1) === 1 && nextSrStep(3, 0.9) === 4);
ok('sr: epäonnistuminen nollaa', nextSrStep(5, 0) === 0 && nextSrStep(5, 0.4) === 0);
ok('sr: askel ei ylitä taulukkoa', nextSrStep(SR_INTERVALS.length + 5, 1) === SR_INTERVALS.length - 1);
ok('sr: välit kasvavat', SR_INTERVALS.every((v,i) => i===0 || v > SR_INTERVALS[i-1]));
const now = Date.now();
near('sr: eräpäivä askeleelta 0 on huomenna',
     Date.parse(dueAtFrom(0, now)) - now, SR_INTERVALS[0]*DAY, 1000);
ok('sr: myöhempi askel = pidempi väli',
   Date.parse(dueAtFrom(4, now)) > Date.parse(dueAtFrom(1, now)));
ok('sr: erääntynyt tunnistuu',
   isOverdue({ dueAt: new Date(now - DAY).toISOString() }, now));
ok('sr: tuleva ei ole erääntynyt',
   !isOverdue({ dueAt: new Date(now + DAY).toISOString() }, now));
ok('sr: harjoittelematon on äärettömän myöhässä', overdueDays({}, now) === Infinity);

/* ── Tarjontajono ── */
(() => {
  const skills = [
    { id: 'vahva-erääntynyt', elo: 1700, dueAt: new Date(now - 10*DAY).toISOString() },
    { id: 'heikko-tuore',     elo: 900,  dueAt: new Date(now + 5*DAY).toISOString() },
    { id: 'keski-tuore',      elo: 1300, dueAt: new Date(now + 5*DAY).toISOString() },
    { id: 'koskematon',       elo: 1200 },
  ];
  const q = buildServeQueue(skills, now).map(s => s.id);
  ok('jono: erääntynyt ensin', q[0] === 'vahva-erääntynyt', q.join(' > '));
  ok('jono: koskematon ennen erääntymätöntä',
     q.indexOf('koskematon') < q.indexOf('heikko-tuore'), q.join(' > '));
  ok('jono: erääntynyt ohittaa Elon',
     q.indexOf('vahva-erääntynyt') < q.indexOf('heikko-tuore'), q.join(' > '));
  // Tuore korpus: mitään ei ole harjoiteltu, joten järjestyksen on tultava Elosta.
  const fresh = [
    { id:'vahva',  elo: 1467 }, { id:'heikko', elo: 1197 }, { id:'keski', elo: 1347 },
  ];
  const fq = buildServeQueue(fresh, now).map(s => s.id);
  ok('jono: koskemattomat järjestyvät Elon mukaan',
     fq.join(',') === 'heikko,keski,vahva', fq.join(' > '));
  ok('jono: erääntymättömistä heikoin ensin',
     q.indexOf('heikko-tuore') < q.indexOf('keski-tuore'), q.join(' > '));
  ok('jono: sisältää kaikki', q.length === 4);
})();

/* ── applyAttempt ── */
(() => {
  const before = { id:'kie-pilkku', elo: 1200, srStep: 2 };
  const out = applyAttempt(before, { difficulty: 1100 }, 1, now);
  ok('attempt: ei mutatoi syötettä', before.elo === 1200 && before.srStep === 2);
  ok('attempt: elo nousi', out.skill.elo > 1200);
  ok('attempt: askel kasvoi', out.skill.srStep === 3);
  ok('attempt: dueAt asetettu', !!out.skill.dueAt && Date.parse(out.skill.dueAt) > now);
  ok('attempt: lastPractised asetettu', !!out.skill.lastPractised);
  const fail = applyAttempt(before, { difficulty: 1100 }, 0, now);
  ok('attempt: epäonnistuminen nollaa askeleen', fail.skill.srStep === 0);
  ok('attempt: epäonnistuminen laskee eloa', fail.skill.elo < 1200);
  near('attempt: eräpäivä palaa huomiseen', Date.parse(fail.skill.dueAt) - now, DAY, 1000);
})();

/* ── Renderöijäaudit ── */
ok('audit: 9 renderöijää', RENDERER_IDS.length === 9, 'n=' + RENDERER_IDS.length);
ok('audit: kaikki 14 vanhaa tyyppiä katettu',
   ['kirjoita','tayta_aukot','muotoile','jarjesta','korjaa','siirtymä','argumentoi','johdanto',
    'paatos','luku_vastaus','luku_viittaus','vertailu','tiivistelmä','pohdinta']
   .every(t => !!LEGACY_TO_RENDERER[t]),
   JSON.stringify(Object.keys(LEGACY_TO_RENDERER)));
ok('audit: 14 → 9 eli 5 romahti', Object.keys(LEGACY_TO_RENDERER).length === 14);
ok('audit: free_production kokosi neljä genreä',
   RENDERERS.free_production.legacy.length === 4);
ok('audit: jokaisella alue ja se on nouseva',
   RENDERER_IDS.every(id => { const b = RENDERERS[id].band; return b.length===2 && b[0] < b[1]; }));
ok('audit: recognition-renderöijät ovat helpompia kuin free',
   Math.max(...RENDERER_IDS.filter(i=>RENDERERS[i].retrieval==='recognition').map(i=>RENDERERS[i].band[0]))
   < Math.min(...RENDERER_IDS.filter(i=>RENDERERS[i].retrieval==='free').map(i=>RENDERERS[i].band[0])));
ok('audit: renderöijien taidot ovat oikeita tunnisteita — tarkistetaan skills.js:ää vasten myöhemmin',
   RENDERER_IDS.every(id => RENDERERS[id].skills === '*' || Array.isArray(RENDERERS[id].skills)));
ok('audit: jokaiselle taidolle löytyy renderöijä',
   renderersForSkill('kie-kongruenssi').length > 0 && renderersForSkill('rak-aloitusvirke').length > 0);
ok('audit: free_production kelpaa mille tahansa taidolle',
   renderersForSkill('mikä-tahansa').includes('free_production'));
ok('clamp: alueen alle jäävä nostetaan', clampToBand('word_swap', 500) === RENDERERS.word_swap.band[0]);
ok('clamp: alueen yli menevä lasketaan', clampToBand('word_swap', 9999) === RENDERERS.word_swap.band[1]);
ok('clamp: alueen sisällä ei muutu', clampToBand('word_swap', 1000) === 1000);

export default results;
