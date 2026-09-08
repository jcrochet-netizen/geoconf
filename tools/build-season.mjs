#!/usr/bin/env node
/* ============================================================================
   Construit le fichier d'une édition à partir d'une simple liste de noms.

     1. écrivez tools/season-2026-27.txt — un club par ligne, par ex. :
            Pafos FC
            Shakhtar Donetsk
            AS Trenčín | SVK        ← le code pays est facultatif mais aide
            # les lignes commençant par # sont ignorées
     2. node tools/build-season.mjs 2026-27
     3. le script écrit data/season-2026-27.json

   Les clubs déjà connus (data/clubs.json) sont référencés par leur id.
   Les nouveaux sont résolus via Wikipédia puis Wikidata : on prend les
   coordonnées du stade (P115 → P625), sinon le siège (P159).
   Relisez toujours la sortie : le script signale ce dont il n'est pas sûr.
   ========================================================================== */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEASON = process.argv[2] || '2026-27';
const UA = { 'user-agent': 'GeoConf/1.0 (préparation de données)', accept: 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* Code UEFA à partir du nom de pays Wikidata, pour les clubs inconnus. */
const CC_BY_COUNTRY = {
  armenia: 'ARM', austria: 'AUT', azerbaijan: 'AZE', belgium: 'BEL', 'bosnia and herzegovina': 'BIH',
  belarus: 'BLR', bulgaria: 'BUL', croatia: 'CRO', cyprus: 'CYP', czechia: 'CZE', 'czech republic': 'CZE',
  denmark: 'DEN', england: 'ENG', spain: 'ESP', estonia: 'EST', finland: 'FIN', france: 'FRA',
  'faroe islands': 'FRO', georgia: 'GEO', germany: 'GER', gibraltar: 'GIB', greece: 'GRE',
  hungary: 'HUN', ireland: 'IRL', iceland: 'ISL', israel: 'ISR', italy: 'ITA', kazakhstan: 'KAZ',
  kosovo: 'KOS', liechtenstein: 'LIE', lithuania: 'LTU', luxembourg: 'LUX', latvia: 'LVA',
  moldova: 'MDA', 'north macedonia': 'MKD', malta: 'MLT', montenegro: 'MNE', netherlands: 'NED',
  'northern ireland': 'NIR', norway: 'NOR', poland: 'POL', portugal: 'POR', romania: 'ROU',
  scotland: 'SCO', serbia: 'SRB', switzerland: 'SUI', slovakia: 'SVK', slovenia: 'SVN',
  sweden: 'SWE', turkey: 'TUR', türkiye: 'TUR', ukraine: 'UKR', wales: 'WAL',
  'united kingdom': 'ENG'
};

async function j(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (a === 3) throw e; await sleep(1200 * (a + 1)); }
  }
}

async function findQid(name) {
  const t = encodeURIComponent(name);
  let d = await j(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=${t}`);
  let page = Object.values(d.query.pages)[0];
  if (page?.pageprops?.wikibase_item) return { qid: page.pageprops.wikibase_item, title: page.title };
  d = await j(`https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=1&srsearch=${t}%20football%20club`);
  const hit = d.query.search[0];
  if (!hit) return null;
  d = await j(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(hit.title)}`);
  page = Object.values(d.query.pages)[0];
  return page?.pageprops?.wikibase_item ? { qid: page.pageprops.wikibase_item, title: page.title, fuzzy: true } : null;
}

const ent = async q => (await j(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims|labels&languages=en|fr&ids=${q}`)).entities[q];
const idsOf = (e, p) => (e?.claims?.[p] || [])
  .filter(c => c.mainsnak?.datavalue?.type === 'wikibase-entityid')
  .sort((a, b) => ({ preferred: 0, normal: 1, deprecated: 2 }[a.rank] ?? 1) - ({ preferred: 0, normal: 1, deprecated: 2 }[b.rank] ?? 1))
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

const txtPath = join(ROOT, `tools/season-${SEASON}.txt`);
let raw;
try { raw = await readFile(txtPath, 'utf8'); }
catch { console.error(`✖ Fichier introuvable : tools/season-${SEASON}.txt`); process.exit(1); }

const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
console.log(`${lines.length} clubs à traiter pour ${SEASON}\n`);

const out = [], warn = [];
for (const line of lines) {
  const [rawName, forcedCc] = line.split('|').map(s => s && s.trim());
  const known = byId.get(norm(rawName).replace(/ /g, '-')) || byName.get(norm(rawName));
  if (known) { out.push(known.id); console.log(`  · ${rawName.padEnd(28)} → déjà connu (${known.id})`); continue; }

  try {
    const found = await findQid(rawName);
    if (!found) throw new Error('introuvable sur Wikipédia');
    const e = await ent(found.qid);

    let lat = null, lon = null, city = null;
    for (const v of idsOf(e, 'P115').slice(0, 2)) {
      const ve = await ent(v); const c = coordOf(ve);
      if (c) { ({ lat, lon } = c); const cq = idsOf(ve, 'P131')[0]; if (cq) city = labelOf(await ent(cq)); break; }
    }
    if (lat == null) for (const h of idsOf(e, 'P159').slice(0, 1)) {
      const he = await ent(h); const c = coordOf(he);
      if (c) { ({ lat, lon } = c); city = labelOf(he); }
    }
    if (lat == null) { const c = coordOf(e); if (c) ({ lat, lon } = c); }
    if (lat == null) throw new Error('aucune coordonnée dans Wikidata');

    let cc = forcedCc;
    if (!cc) { const cq = idsOf(e, 'P17')[0]; if (cq) cc = CC_BY_COUNTRY[norm(labelOf(await ent(cq)) || '')]; }

    const entry = { name: rawName, city: city || '?', cc: cc || '?', lat, lon, wiki: found.title };
    out.push(entry);
    const flags = [found.fuzzy && 'titre approché', !city && 'ville à compléter', !cc && 'pays à compléter'].filter(Boolean);
    if (flags.length) warn.push(`${rawName} — ${flags.join(', ')}`);
    console.log(`  ${flags.length ? '⚠' : '✓'} ${rawName.padEnd(28)} → ${city || '?'} (${cc || '?'}) ${lat}, ${lon}`);
    await sleep(120);
  } catch (err) {
    out.push({ name: rawName, city: '?', cc: forcedCc || '?', lat: null, lon: null, _erreur: String(err.message) });
    warn.push(`${rawName} — ${err.message}`);
    console.log(`  ✖ ${rawName.padEnd(28)} ${err.message}`);
  }
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
