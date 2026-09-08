#!/usr/bin/env node
/* ============================================================================
   Construit le fichier d'une édition à partir d'une simple liste de noms.

     1. écrivez tools/season-2026-27.txt — un club par ligne, par ex. :
            Pafos FC
            AS Trenčín | SVK        ← le code pays est facultatif mais aide
            # les lignes commençant par # sont ignorées
     2. node tools/build-season.mjs 2026-27
     3. le script écrit data/season-2026-27.json

   Les clubs déjà connus (data/clubs.json) sont référencés par leur id.
   Les nouveaux sont résolus via Wikipédia puis Wikidata : on prend les
   coordonnées du stade (P115 → P625), sinon le siège (P159).

   Les appels sont GROUPÉS (jusqu'à 40 entités par requête) : Wikidata renvoie
   des HTTP 429 si on l'interroge club par club.

   Le script vérifie aussi le sport de l'entité (P641) : « Kauno Žalgiris » sans
   le préfixe FK redirige vers le club de BASKET de Kaunas, avec les coordonnées
   de la Žalgiris Arena. Une redirection Wikipédia peut mener n'importe où.
   Relisez toujours la sortie : le script signale ce dont il n'est pas sûr.
   ========================================================================== */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEASON = process.argv[2] || '2026-27';
const UA = {
  'user-agent': 'GeoConf/1.0 (jeu de géographie du football ; préparation de données)',
  accept: 'application/json'
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

const CC_BY_COUNTRY = {
  albania: 'ALB', andorra: 'AND', armenia: 'ARM', austria: 'AUT', azerbaijan: 'AZE', belgium: 'BEL',
  'bosnia and herzegovina': 'BIH', belarus: 'BLR', bulgaria: 'BUL', croatia: 'CRO', cyprus: 'CYP',
  czechia: 'CZE', 'czech republic': 'CZE', denmark: 'DEN', england: 'ENG', spain: 'ESP',
  estonia: 'EST', finland: 'FIN', france: 'FRA', 'faroe islands': 'FRO', georgia: 'GEO',
  germany: 'GER', gibraltar: 'GIB', greece: 'GRE', hungary: 'HUN', ireland: 'IRL', iceland: 'ISL',
  israel: 'ISR', italy: 'ITA', kazakhstan: 'KAZ', kosovo: 'KOS', liechtenstein: 'LIE',
  lithuania: 'LTU', luxembourg: 'LUX', latvia: 'LVA', moldova: 'MDA', 'north macedonia': 'MKD',
  malta: 'MLT', montenegro: 'MNE', netherlands: 'NED', 'northern ireland': 'NIR', norway: 'NOR',
  poland: 'POL', portugal: 'POR', romania: 'ROU', scotland: 'SCO', serbia: 'SRB',
  switzerland: 'SUI', slovakia: 'SVK', slovenia: 'SVN', sweden: 'SWE', turkey: 'TUR',
  'türkiye': 'TUR', ukraine: 'UKR', wales: 'WAL', 'united kingdom': 'ENG', monaco: 'FRA'
};

/* Un 429 impose d'attendre ce que le serveur demande, pas ce qui nous arrange. */
async function j(url) {
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 429 || r.status === 503) {
        const wait = (Number(r.headers.get('retry-after')) || 5 * (a + 1)) * 1000;
        await sleep(wait);
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (a === 4) throw e; await sleep(1500 * (a + 1)); }
  }
  throw new Error('trop de tentatives (429)');
}

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Titres Wikipédia → QID, par paquets de 40. */
async function qidsForTitles(titles) {
  const out = new Map();
  for (const batch of chunk([...new Set(titles)], 40)) {
    const d = (await j('https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1' +
      '&prop=pageprops&ppprop=wikibase_item&titles=' + encodeURIComponent(batch.join('|')))).query;
    const alias = new Map();
    for (const k of ['normalized', 'redirects']) for (const r of d[k] || []) alias.set(r.from, r.to);
    const solved = new Map();
    for (const p of Object.values(d.pages)) if (p.pageprops) solved.set(p.title, p.pageprops.wikibase_item);
    for (const t of batch) {
      let cur = t;
      for (let i = 0; i < 3; i++) cur = alias.get(cur) ?? cur;
      if (solved.has(cur)) out.set(t, { qid: solved.get(cur), title: cur });
    }
    await sleep(200);
  }
  return out;
}

/** Recherche plein texte, pour les titres qui n'ont pas matché tels quels. */
async function searchTitle(name) {
  const d = await j('https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=1' +
    '&srsearch=' + encodeURIComponent(name + ' football club'));
  return d.query.search[0]?.title ?? null;
}

/** Entités Wikidata, par paquets de 40. */
async function entities(qids) {
  const out = new Map();
  for (const batch of chunk([...new Set(qids.filter(Boolean))], 40)) {
    const d = await j('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json' +
      '&props=claims|labels&languages=en|fr&ids=' + batch.join('|'));
    for (const [k, v] of Object.entries(d.entities || {})) out.set(k, v);
    await sleep(250);
  }
  return out;
}

const RANK = { preferred: 0, normal: 1, deprecated: 2 };
const idsOf = (e, p) => (e?.claims?.[p] || [])
  .filter(c => c.mainsnak?.datavalue?.type === 'wikibase-entityid')
  .sort((a, b) => (RANK[a.rank] ?? 1) - (RANK[b.rank] ?? 1))
  .map(c => c.mainsnak.datavalue.value.id);
const coordOf = e => {
  const c = (e?.claims?.P625 || []).find(x => x.mainsnak?.datavalue?.type === 'globecoordinate');
  return c ? { lat: +c.mainsnak.datavalue.value.latitude.toFixed(5), lon: +c.mainsnak.datavalue.value.longitude.toFixed(5) } : null;
};
const labelOf = e => e?.labels?.en?.value || e?.labels?.fr?.value || null;

/* ------------------------------------------------------------------------ */
const clubs = JSON.parse(await readFile(join(ROOT, 'data/clubs.json'), 'utf8'));
const byId = new Map(clubs.map(c => [c.id, c]));
const byName = new Map(clubs.map(c => [norm(c.name), c]));

let raw;
try { raw = await readFile(join(ROOT, `tools/season-${SEASON}.txt`), 'utf8'); }
catch { console.error(`✖ Fichier introuvable : tools/season-${SEASON}.txt`); process.exit(1); }

const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
console.log(`${lines.length} clubs à traiter pour ${SEASON}\n`);

/* 1. on sépare les clubs déjà connus de ceux à résoudre */
const rows = lines.map(line => {
  const [name, cc] = line.split('|').map(s => s && s.trim());
  const known = byId.get(norm(name).replace(/ /g, '-')) || byName.get(norm(name));
  return { name, cc, known };
});
const toResolve = rows.filter(r => !r.known);
console.log(`${rows.length - toResolve.length} déjà connus · ${toResolve.length} à résoudre\n`);

/* 2. titres → QID, avec repli sur la recherche */
let found = await qidsForTitles(toResolve.map(r => r.name));
const missing = toResolve.filter(r => !found.has(r.name));
if (missing.length) {
  const alt = new Map();
  for (const r of missing) {
    const t = await searchTitle(r.name);
    if (t) alt.set(r.name, t);
    await sleep(250);
  }
  const second = await qidsForTitles([...alt.values()]);
  for (const [orig, title] of alt) {
    const hit = second.get(title);
    if (hit) found.set(orig, { ...hit, fuzzy: true });
  }
}

/* 3. entités des clubs, puis des stades/sièges, puis des villes */
const clubEnts = await entities([...found.values()].map(v => v.qid));
const lvl2 = [];
for (const v of found.values()) {
  const e = clubEnts.get(v.qid);
  lvl2.push(...idsOf(e, 'P115').slice(0, 2), ...idsOf(e, 'P159').slice(0, 1), ...idsOf(e, 'P17').slice(0, 1));
}
const venueEnts = await entities(lvl2);
const lvl3 = [];
for (const e of venueEnts.values()) lvl3.push(...idsOf(e, 'P131').slice(0, 1));
const cityEnts = await entities(lvl3);

/* 4. assemblage */
const out = [], warn = [];
for (const r of rows) {
  if (r.known) { out.push(r.known.id); console.log(`  · ${r.name.padEnd(30)} → déjà connu (${r.known.id})`); continue; }
  const hit = found.get(r.name);
  if (!hit) {
    out.push({ name: r.name, city: '?', cc: r.cc || '?', lat: null, lon: null, _erreur: 'introuvable' });
    warn.push(`${r.name} — introuvable sur Wikipédia`);
    console.log(`  ✖ ${r.name.padEnd(30)} introuvable`);
    continue;
  }
  const e = clubEnts.get(hit.qid);
  let lat = null, lon = null, city = null;

  for (const v of idsOf(e, 'P115').slice(0, 2)) {
    const ve = venueEnts.get(v), c = coordOf(ve);
    if (c) { ({ lat, lon } = c); const cq = idsOf(ve, 'P131')[0]; if (cq) city = labelOf(cityEnts.get(cq)); break; }
  }
  if (lat == null) for (const h of idsOf(e, 'P159').slice(0, 1)) {
    const he = venueEnts.get(h), c = coordOf(he);
    if (c) { ({ lat, lon } = c); city = labelOf(he); }
  }
  if (lat == null) { const c = coordOf(e); if (c) ({ lat, lon } = c); }

  let cc = r.cc;
  if (!cc) { const cq = idsOf(e, 'P17')[0]; if (cq) cc = CC_BY_COUNTRY[norm(labelOf(venueEnts.get(cq)) || '')]; }

  if (lat == null) {
    out.push({ name: r.name, city: city || '?', cc: cc || '?', lat: null, lon: null, wiki: hit.title, _erreur: 'aucune coordonnée' });
    warn.push(`${r.name} — aucune coordonnée dans Wikidata`);
    console.log(`  ✖ ${r.name.padEnd(30)} aucune coordonnée`);
    continue;
  }
  out.push({ name: r.name, city: city || '?', cc: cc || '?', lat, lon, wiki: hit.title });
  const sports = idsOf(e, 'P641');
  const notFootball = sports.length && !sports.includes('Q2736');
  const flags = [hit.fuzzy && 'titre approché', notFootball && 'CE N’EST PAS UN CLUB DE FOOTBALL',
                 !city && 'ville à compléter', !cc && 'pays à compléter'].filter(Boolean);
  if (flags.length) warn.push(`${r.name} — ${flags.join(', ')}`);
  console.log(`  ${flags.length ? '⚠' : '✓'} ${r.name.padEnd(30)} → ${city || '?'} (${cc || '?'}) ${lat}, ${lon}`);
}

const dest = join(ROOT, `data/season-${SEASON}.json`);
let head = [];
try { head = JSON.parse(await readFile(dest, 'utf8'))._lisez_moi || []; } catch {}
await writeFile(dest, JSON.stringify({ _lisez_moi: head, clubs: out }, null, 1) + '\n');

console.log(`\n→ data/season-${SEASON}.json écrit (${out.length} entrées)`);
if (warn.length) {
  console.log(`\n⚠ ${warn.length} entrée(s) à relire à la main :`);
  warn.forEach(w => console.log('   · ' + w));
}
