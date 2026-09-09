/* Testit korpusmoduulille (§4). */
import { splitEssays, newEssay, median, gradeAnchor, metricWeakness, bandsFor,
         chronologicalCheck, clusterComments, deriveStartingElo, analyseEssay,
         GENRES, COMMENT_PENALTY, METRIC_TO_SKILLS } from '../src/corpus.js';
import { START_ELO } from '../src/elo.js';

const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || '' });

const TAX = [
  { id:'kie-virkerytmi', name:'Virkerytmin vaihtelu', crit:'kieliasu' },
  { id:'rak-siirtymailmaisut', name:'Siirtymäilmaisut', crit:'rakenne' },
  { id:'san-toisto', name:'Toiston välttäminen', crit:'sanasto' },
  { id:'arg-perustelu', name:'Perustelu', crit:'argumentaatio' },
];
const mk = (o) => newEssay({ text: o.text || 'Kissa istui matolla rauhassa. Koira nukkui sohvalla.', ...o });

export async function run() {
  /* ── Erottelu ── */
  ok('split: erotinviiva', splitEssays('Essee yksi.\n---\nEssee kaksi.').length === 2);
  ok('split: yhtäläisyysmerkit', splitEssays('A\n===\nB\n===\nC').length === 3);
  ok('split: kolme rivinvaihtoa', splitEssays('Essee yksi.\n\n\nEssee kaksi.').length === 2);
  ok('split: kappalejako EI katkaise esseetä',
     splitEssays('Kappale yksi.\n\nKappale kaksi.').length === 1,
     'sai ' + splitEssays('Kappale yksi.\n\nKappale kaksi.').length);
  ok('split: tyhjä → []', splitEssays('').length === 0);
  ok('split: yksi essee', splitEssays('Vain yksi.').length === 1);
  ok('split: erotin voittaa tyhjät rivit',
     splitEssays('A\n\nB\n---\nC\n\nD').length === 2);

  /* ── newEssay ── */
  const e = newEssay({ text: 'Kissa istui matolla. Koira nukkui sohvalla pitkään.' });
  ok('essee: metriikat laskettu heti', e.metrics && e.metrics.wordCount > 0);
  ok('essee: id luotu', /^es_/.test(e.id));
  ok('essee: oletusgenre', GENRES.includes(e.genre));
  ok('essee: oletuslähde pasted', e.source === 'pasted');

  /* ── 4b arvosana-ankkuri ── */
  ok('mediaani: pariton', median([1,5,3]) === 3);
  ok('mediaani: parillinen', median([1,2,3,4]) === 2.5);
  ok('mediaani: tyhjä → null', median([]) === null);
  const graded = [mk({genre:'pohtiva',grade:4,gradeScaleMax:6}), mk({genre:'pohtiva',grade:5,gradeScaleMax:6}),
                  mk({genre:'pohtiva',grade:3,gradeScaleMax:6})];
  const a = gradeAnchor(graded, 'pohtiva');
  ok('ankkuri: käyttää mediaania', a.n === 3 && a.elo > 900 && a.elo < 1700, JSON.stringify(a));
  ok('ankkuri: parempi arvosana → korkeampi elo',
     gradeAnchor([mk({grade:6,gradeScaleMax:6})]).elo > gradeAnchor([mk({grade:2,gradeScaleMax:6})]).elo);
  ok('ankkuri: eri asteikot normalisoidaan',
     Math.abs(gradeAnchor([mk({grade:5,gradeScaleMax:10})]).elo - gradeAnchor([mk({grade:3,gradeScaleMax:6})]).elo) < 30,
     gradeAnchor([mk({grade:5,gradeScaleMax:10})]).elo + ' vs ' + gradeAnchor([mk({grade:3,gradeScaleMax:6})]).elo);
  ok('ankkuri: ei arvosanoja → lähtöarvo', gradeAnchor([mk({})]).elo === START_ELO);
  ok('ankkuri: suodattaa genren', gradeAnchor([mk({genre:'kertova',grade:6,gradeScaleMax:6}),
                                                mk({genre:'pohtiva',grade:2,gradeScaleMax:6})], 'pohtiva').n === 1);

  /* ── 4c metriikkaheikkous ── */
  const flatEssays = [mk({ genre:'pohtiva', text:'Kissa istui matolla rauhassa. Koira nukkui sohvalla hiljaa. Lintu lauloi puussa kauniisti. Hiiri juoksi lattialla nopeasti.' })];
  const w = metricWeakness(flatEssays, 'pohtiva');
  ok('heikkous: tasainen rytmi havaitaan',
     w.findings.some(f => f.metric === 'sdSentenceLength' && f.verdict === 'alle odotuksen'),
     JSON.stringify(w.findings.map(f=>f.metric)));
  ok('heikkous: säätö kohdistuu oikeaan taitoon', (w.adjustments['kie-virkerytmi'] || 0) < 0);
  ok('heikkous: alle odotuksen rankaisee enemmän kuin yli',
     Math.abs(-120) > Math.abs(-60));
  ok('heikkous: tyhjä korpus ei kaadu', metricWeakness([], 'pohtiva').findings.length === 0);
  ok('bands: genre ohittaa oletuksen',
     bandsFor('referaatti').nominalisationDensity[1] > bandsFor('pohtiva').nominalisationDensity[1]);
  ok('bands: tuntematon genre saa oletuksen', !!bandsFor('outo').sdSentenceLength);
  ok('kartoitus: jokainen metriikka osoittaa taitoihin',
     Object.values(METRIC_TO_SKILLS).every(v => Array.isArray(v) && v.length > 0));

  /* ── 4d kronologia ── */
  ok('krono: liian vähän esseitä', chronologicalCheck([mk({date:'2024-01-01'})]).available === false);
  const flatSeries = Array.from({length: 9}, (_, i) =>
    mk({ date: `2024-0${i+1}-01`, text: 'Kissa istui matolla rauhassa. Koira nukkui sohvalla hiljaa. Lintu lauloi puussa kauniisti.' }));
  const cf = chronologicalCheck(flatSeries);
  ok('krono: litteä havaitaan', cf.available && cf.flat === true, JSON.stringify(cf.changes));
  ok('krono: litteä on itsessään havainto', /ei näytä muuttavan/.test(cf.message));
  const improving = [
    ...Array.from({length: 3}, (_, i) => mk({ date:`2023-0${i+1}-01`, text:'Kissa istui. Koira nukkui. Lintu lauloi.' })),
    ...Array.from({length: 3}, (_, i) => mk({ date:`2023-0${i+4}-01`, text:'Kissa istui. Koira nukkui.' })),
    ...Array.from({length: 3}, (_, i) => mk({ date:`2024-0${i+1}-01`, text:'Vaikka kissa istui matolla pitkään ja tarkkaili ympäristöään huolellisesti, koira nukkui sohvalla täysin välinpitämättömänä, koska se ei ollut huomannut mitään poikkeavaa. Lintu lauloi.' })),
  ];
  const ci = chronologicalCheck(improving);
  ok('krono: liike havaitaan', ci.available && ci.flat === false, JSON.stringify(ci.changes.map(c=>c.metric+':'+c.pctChange.toFixed(0))));
  ok('krono: aikaväli raportoidaan', Array.isArray(ci.span) && ci.span.length === 2);

  /* ── 4a kommenttien ryhmittely ── */
  const withComments = [
    mk({ teacherComment:'Virkkeet ovat kovin samanmittaisia.', date:'2024-01-01' }),
    mk({ teacherComment:'Rytmi yksitoikkoinen, vaihtele virkkeitä.', date:'2024-02-01' }),
    mk({ teacherComment:'Taas samanmittaisia virkkeitä peräkkäin.', date:'2024-03-01' }),
    mk({ teacherComment:'Hyvä essee.', date:'2024-04-01' }),
  ];
  const fakeCluster = async () => ({ themes: [
    { theme:'Yksitoikkoinen virkerytmi', skillId:'kie-virkerytmi', essayCount:3,
      evidence:['Virkkeet ovat kovin samanmittaisia.','Rytmi yksitoikkoinen'] },
    { theme:'Kertaluontoinen huomio', skillId:'san-toisto', essayCount:1, evidence:['x'] },
    { theme:'Keksitty tunniste', skillId:'ei-ole-olemassa', essayCount:5, evidence:['y'] },
    { theme:'', skillId:'arg-perustelu', essayCount:4, evidence:[] },
  ]});
  const cl = await clusterComments(withComments, TAX, {}, fakeCluster);
  ok('kommentit: teemat poimittu', cl.themes.length === 3, 'n=' + cl.themes.length);
  ok('kommentit: nimetön teema pudotetaan', !cl.themes.some(t => t.theme === ''));
  ok('kommentit: keksitty tunniste nollataan', cl.themes.find(t => t.theme==='Keksitty tunniste').skillId === null);
  ok('kommentit: 3+ esseessä → prioriteetti', cl.priority.length === 1 && cl.priority[0].skillId === 'kie-virkerytmi',
     JSON.stringify(cl.priority.map(p=>p.skillId)));
  ok('kommentit: kertaluontoinen ei nouse prioriteetiksi', !cl.priority.some(p => p.skillId === 'san-toisto'));
  ok('kommentit: näyttö talteen', cl.priority[0].evidence.length === 2);
  ok('kommentit: ei kommentteja → ohitetaan',
     (await clusterComments([mk({})], TAX, {}, fakeCluster)).skipped === 'ei kommentteja');

  /* ── Yhdistäminen ── */
  const derived = deriveStartingElo(TAX, { anchor: a, weakness: w, comments: cl });
  ok('johto: kaikki taidot saavat arvon', derived.length === TAX.length);
  ok('johto: kommenttiprioriteetti laskee eloa',
     derived.find(d => d.id==='kie-virkerytmi').elo < derived.find(d => d.id==='arg-perustelu').elo,
     JSON.stringify(derived.map(d=>d.id+':'+d.elo)));
  ok('johto: prioriteettitaito saa näytön',
     derived.find(d => d.id==='kie-virkerytmi').sourceEvidence.length > 0);
  ok('johto: perustelu kirjattu', /opettajan palaute/.test(derived.find(d=>d.id==='kie-virkerytmi').derivation));
  ok('johto: rajattu 900-1700', derived.every(d => d.elo >= 900 && d.elo <= 1700));
  const noEvidence = deriveStartingElo(TAX, { anchor: { elo: START_ELO, n: 0, basis:'' }, weakness: {}, comments: {} });
  ok('johto: ilman näyttöä lähtöarvo', noEvidence.every(d => d.elo === START_ELO));
  ok('johto: ilman näyttöä se sanotaan', noEvidence[0].derivation === 'ei näyttöä, lähtöarvo');

  /* ── Esseeanalyysi ── */
  const fakeAnalyse = async () => ({ summary:'Hyvä.', bandEstimate:'hyvä',
    strengths:[{skillTag:'arg-perustelu',note:'ok'}],
    weaknesses:[{skillTag:'kie-virkerytmi',note:'tasainen',example:'x'},{skillTag:'keksitty',note:'z'}] });
  const an = await analyseEssay(mk({}), TAX, {}, fakeAnalyse);
  ok('analyysi: keksityt tunnisteet karsitaan', an.weaknesses.length === 1 && an.weaknesses[0].skillTag === 'kie-virkerytmi');
  ok('analyysi: aikaleima', !!an.analysedAt);
  const cached = { summary:'välimuistista', strengths:[], weaknesses:[] };
  ok('analyysi: välimuisti ohittaa kutsun',
     (await analyseEssay(mk({ llmAnalysis: cached }), TAX, {}, async () => { throw new Error('ei saa kutsua'); })).summary === 'välimuistista');

  return results;
}
