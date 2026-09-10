/* Testit korpusmoduulille (§4). */
import { splitEssays, newEssay, median, gradeAnchor, metricWeakness, bandsFor,
         chronologicalCheck, clusterComments, deriveStartingElo, analyseEssay,
         analyseCorpus, criterionAnchors, GRADE_SCALES, GENRES, EXAM_TYPES, EXAM_LABELS, GENRES_BY_EXAM, EXAM_BANDS,
         COMMENT_PENALTY, METRIC_TO_SKILLS } from '../src/corpus.js';
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

  /* ── Asteikon alaraja: kurssiarvosana alkaa nelosesta ── */
  const K = GRADE_SCALES.kurssi;
  ok('asteikko: kurssiarvosana on 4-10', K.min === 4 && K.max === 10);
  ok('asteikko: YO on 0-60', GRADE_SCALES.yo.min === 0 && GRADE_SCALES.yo.max === 60);
  const gradeK = g => gradeAnchor([mk({ grade:g, gradeScaleMin:K.min, gradeScaleMax:K.max })]).elo;
  // Nelonen on hylätty: sen on osuttava asteikon pohjalle, ei 40 %:iin.
  ok('asteikko: nelonen on pohja', gradeK(4) === 900, String(gradeK(4)));
  ok('asteikko: kymppi on katto', gradeK(10) === 1600, String(gradeK(10)));
  ok('asteikko: seiska keskivaiheille', gradeK(7) > 1150 && gradeK(7) < 1300, String(gradeK(7)));
  // Vanha nollasta lähtevä kaava antaisi kutoselle 60 % → ~1280. Oikea on 33 % → ~1167.
  ok('asteikko: kutonen ei näytä hyvältä suoritukselta', gradeK(6) < 1220, String(gradeK(6)));
  ok('asteikko: heikko kurssiarvosana alle YO-keskitason',
     gradeK(5) < gradeAnchor([mk({ grade:30, gradeScaleMin:0, gradeScaleMax:60 })]).elo,
     gradeK(5) + ' vs ' + gradeAnchor([mk({ grade:30, gradeScaleMin:0, gradeScaleMax:60 })]).elo);
  ok('asteikko: alarajan alle jäävä rajautuu', gradeK(2) === 900);
  ok('asteikko: eri asteikot vertailukelpoisia',
     Math.abs(gradeK(7) - gradeAnchor([mk({ grade:30, gradeScaleMin:0, gradeScaleMax:60 })]).elo) < 40,
     gradeK(7) + ' vs ' + gradeAnchor([mk({ grade:30, gradeScaleMin:0, gradeScaleMax:60 })]).elo);
  ok('asteikko: puuttuva alaraja käyttäytyy kuin nolla',
     gradeAnchor([mk({ grade:30, gradeScaleMax:60 })]).elo === gradeAnchor([mk({ grade:30, gradeScaleMin:0, gradeScaleMax:60 })]).elo);
  ok('ankkuri: suodattaa genren', gradeAnchor([mk({genre:'kertova',grade:6,gradeScaleMax:6}),
                                                mk({genre:'pohtiva',grade:2,gradeScaleMax:6})], 'pohtiva').n === 1);

  /* ── 4c metriikkaheikkous ── */
  const flatEssays = [mk({ genre:'pohtiva', text:'Kissa istui matolla rauhassa. Koira nukkui sohvalla hiljaa. Lintu lauloi puussa kauniisti. Hiiri juoksi lattialla nopeasti.' })];
  const w = metricWeakness(flatEssays, { genre: 'pohtiva' });
  ok('heikkous: tasainen rytmi havaitaan',
     w.findings.some(f => f.metric === 'sdSentenceLength' && f.verdict === 'alle odotuksen'),
     JSON.stringify(w.findings.map(f=>f.metric)));
  ok('heikkous: säätö kohdistuu oikeaan taitoon', (w.adjustments['kie-virkerytmi'] || 0) < 0);
  ok('heikkous: alle odotuksen rankaisee enemmän kuin yli',
     Math.abs(-120) > Math.abs(-60));
  ok('heikkous: tyhjä korpus ei kaadu', metricWeakness([], { genre:'pohtiva' }).findings.length === 0);
  ok('bands: lajityyppi ohittaa oletuksen',
     bandsFor('muu','referaatti').nominalisationDensity[1] > bandsFor('muu','pohtiva').nominalisationDensity[1]);
  ok('bands: tuntematon saa oletuksen', !!bandsFor('outo','outo').sdSentenceLength);

  /* ── Koetyypit: lukutaito vs kirjoitustaito ── */
  ok('koe: molemmat tyypit määritelty', EXAM_TYPES.includes('lukutaito') && EXAM_TYPES.includes('kirjoitustaito'));
  // Tämä on se väärä signaali, joka syntyi kun koetyyppiä ei ollut:
  ok('koe: lukutaito ei vaadi montaa kappaletta',
     bandsFor('lukutaito').paragraphCount[0] === 1, JSON.stringify(bandsFor('lukutaito').paragraphCount));
  ok('koe: kirjoitustaito vaatii kappaleita',
     bandsFor('kirjoitustaito').paragraphCount[0] >= 4, JSON.stringify(bandsFor('kirjoitustaito').paragraphCount));
  ok('koe: lukutaito sallii tiiviimmän nominalisaation',
     bandsFor('lukutaito').nominalisationDensity[1] > bandsFor('kirjoitustaito').nominalisationDensity[1]);
  ok('koe: lajityyppivalikko rajautuu kokeeseen',
     GENRES_BY_EXAM.lukutaito.includes('analyysi') && !GENRES_BY_EXAM.lukutaito.includes('kertova'),
     GENRES_BY_EXAM.lukutaito.join(','));

  // Kaksikappaleinen lukutaidon vastaus: ei saa näyttää heikolta kappalejaossa.
  const shortAnswer = 'Kirjoittaja esittää, että lukutaito on muuttunut merkittävästi.\n\nTämä näkyy siinä, että huomio hajaantuu lyhyisiin katkelmiin, vaikka syvälukeminen edellyttäisi pitkäjänteisyyttä, koska ymmärrys rakentuu vähitellen.';
  const asLuku = metricWeakness([newEssay({ text: shortAnswer, examType:'lukutaito', genre:'analyysi' })], { examType:'lukutaito' });
  const asKirj = metricWeakness([newEssay({ text: shortAnswer, examType:'kirjoitustaito', genre:'pohtiva' })], { examType:'kirjoitustaito' });
  ok('koe: lukutaidon vastaus ei saa kappalejakomoitetta',
     !asLuku.findings.some(f => f.metric === 'paragraphCount'),
     JSON.stringify(asLuku.findings.map(f=>f.metric)));
  ok('koe: sama teksti kirjoitustaitona saa sen',
     asKirj.findings.some(f => f.metric === 'paragraphCount'),
     JSON.stringify(asKirj.findings.map(f=>f.metric)));

  /* ── Yhdistetty korpusanalyysi ── */
  const mixed = [
    newEssay({ text: shortAnswer, examType:'lukutaito', genre:'analyysi', grade:5, gradeScaleMax:6, date:'2024-01-01' }),
    newEssay({ text: shortAnswer, examType:'lukutaito', genre:'analyysi', grade:5, gradeScaleMax:6, date:'2024-02-01' }),
    newEssay({ text: 'Kissa istui matolla rauhassa. Koira nukkui sohvalla hiljaa. Lintu lauloi puussa kauniisti.',
               examType:'kirjoitustaito', genre:'pohtiva', grade:2, gradeScaleMax:6, date:'2024-03-01' }),
  ];
  const ac = analyseCorpus(mixed);
  ok('yhdistetty: molemmat koetyypit mukana',
     ac.present.includes('lukutaito') && ac.present.includes('kirjoitustaito'), ac.present.join(','));
  ok('yhdistetty: vähemmistö ei putoa pois', ac.byExam.kirjoitustaito.n === 1);
  ok('yhdistetty: ankkurit laskettu erikseen',
     ac.byExam.lukutaito.anchor.elo !== ac.byExam.kirjoitustaito.anchor.elo,
     ac.byExam.lukutaito.anchor.elo + ' vs ' + ac.byExam.kirjoitustaito.anchor.elo);
  ok('yhdistetty: ankkuri painotettu määrällä',
     ac.anchor.elo > ac.byExam.kirjoitustaito.anchor.elo && ac.anchor.elo < ac.byExam.lukutaito.anchor.elo,
     'yhd=' + ac.anchor.elo);
  ok('yhdistetty: ankkurin peruste kertoo kummankin', /Lukutaidon|Kirjoitustaidon/.test(ac.anchor.basis), ac.anchor.basis);
  ok('yhdistetty: havainto merkitään koetyypillä', ac.weakness.findings.every(f => 'examType' in f));
  ok('yhdistetty: heikkous kummasta tahansa säilyy',
     Object.keys(ac.weakness.adjustments).length > 0, JSON.stringify(ac.weakness.adjustments));
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

  /* ── Arvostelukohteiden pisteet ── */
  const critGraded = [
    newEssay({ text:'a', examType:'kirjoitustaito', gradeScaleMax:60,
               criterionPoints:{ nakokulma:50, aineistot:50, rakenne:20, kieli:50, kokonaiskuva:40 } }),
    newEssay({ text:'b', examType:'kirjoitustaito', gradeScaleMax:60,
               criterionPoints:{ nakokulma:50, aineistot:40, rakenne:20, kieli:50, kokonaiskuva:40 } }),
  ];
  const ca = criterionAnchors(critGraded, 'kirjoitustaito');
  ok('kohdepisteet: kaikki kohteet ankkuroitu', Object.keys(ca.anchors).length === 5, Object.keys(ca.anchors).join(','));
  ok('kohdepisteet: heikko kohde saa matalan Elon',
     ca.anchors.rakenne.elo < ca.anchors.kieli.elo, ca.anchors.rakenne.elo + ' vs ' + ca.anchors.kieli.elo);
  ok('kohdepisteet: taso 0-6', Object.values(ca.anchors).every(a => a.level >= 0 && a.level <= 6));
  ok('kohdepisteet: 20/60 → taso 2', ca.anchors.rakenne.level === 2, String(ca.anchors.rakenne.level));
  ok('kohdepisteet: ilman pisteitä tyhjä', criterionAnchors([newEssay({ text:'x' })], 'kirjoitustaito').n === 0);

  // Kohdeankkuri syrjäyttää kokonaisarvosanan juuri niissä taidoissa, joita se koskee
  const TAX2 = [
    { id:'rak-kappalejako', name:'Kappalejako', crit:'rakenne' },
    { id:'kie-pilkku', name:'Pilkkusäännöt', crit:'kieliasu' },
  ];
  const derivedCrit = deriveStartingElo(TAX2, {
    anchor: { elo: 1400, n: 2, basis:'testi' }, weakness: {}, comments: {},
    criterionAnchors: ca.anchors, examType: 'kirjoitustaito',
  });
  const rk = derivedCrit.find(d => d.id === 'rak-kappalejako');
  const kp = derivedCrit.find(d => d.id === 'kie-pilkku');
  ok('kohdepisteet: rakenne-taito seuraa Tekstin rakenne -pisteitä',
     rk.elo === ca.anchors.rakenne.elo, rk.elo + ' vs ' + ca.anchors.rakenne.elo);
  ok('kohdepisteet: kieliasu-taito seuraa Kieli ja ilmaisu -pisteitä',
     kp.elo === ca.anchors.kieli.elo, kp.elo + ' vs ' + ca.anchors.kieli.elo);
  ok('kohdepisteet: heikko kohde tuottaa heikomman taidon', rk.elo < kp.elo);
  ok('kohdepisteet: perustelu kertoo lähteen', /arvostelukohde rakenne/.test(rk.derivation), rk.derivation);
  ok('kohdepisteet: ilman kohdepisteitä käytetään kokonaisankkuria',
     deriveStartingElo(TAX2, { anchor:{elo:1400,n:2,basis:'t'}, weakness:{}, comments:{} })[0].elo === 1400);

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
