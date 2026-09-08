#!/usr/bin/env node
/* ============================================================================
   Récupère les logos des clubs via l'API Sportmonks et les écrit dans logos/.

   IMPORTANT — le jeu est un site statique : la clé API ne doit JAMAIS s'y
   retrouver. Ce script tourne sur votre machine, télécharge les images une
   bonne fois pour toutes, et c'est le dossier logos/ qui part sur GitHub.

     export SPORTMONKS_TOKEN="votre-cle"
     node tools/fetch-logos.mjs                 # tous les clubs manquants
     node tools/fetch-logos.mjs --force         # re-télécharge tout
     node tools/fetch-logos.mjs --only=pafos-fc # un seul club

   Le rapport tools/logo-report.json liste chaque correspondance et son score
   de confiance : relisez les lignes marquées « à vérifier ».
   Pour corriger un club, ajoutez-le à tools/logo-overrides.json :
     { "pafos-fc": 12345 }              → identifiant d'équipe Sportmonks
     { "ki-klaksvik": "https://…png" }  → URL d'image directe
   ========================================================================== */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.SPORTMONKS_TOKEN || process.env.SPORTMONKS_API_TOKEN;
const API = 'https://api.sportmonks.com/v3/football';
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').split('=')[1];

if (!TOKEN) {
  console.error('✖ Variable SPORTMONKS_TOKEN absente.\n  export SPORTMONKS_TOKEN="votre-cle" puis relancez.');
  process.exit(1);
}

/* Nom de pays tel que Sportmonks le renvoie, par code UEFA. */
const SM_COUNTRY = {
  ARM: 'Armenia', AUT: 'Austria', AZE: 'Azerbaijan', BEL: 'Belgium', BIH: 'Bosnia and Herzegovina',
  BLR: 'Belarus', BUL: 'Bulgaria', CRO: 'Croatia', CYP: 'Cyprus', CZE: 'Czech Republic',
  DEN: 'Denmark', ENG: 'England', ESP: 'Spain', EST: 'Estonia', FIN: 'Finland', FRA: 'France',
  FRO: 'Faroe Islands', GEO: 'Georgia', GER: 'Germany', GIB: 'Gibraltar', GRE: 'Greece',
  HUN: 'Hungary', IRL: 'Ireland', ISL: 'Iceland', ISR: 'Israel', ITA: 'Italy', KAZ: 'Kazakhstan',
  KOS: 'Kosovo', LIE: 'Liechtenstein', LTU: 'Lithuania', LUX: 'Luxembourg', LVA: 'Latvia',
  MDA: 'Moldova', MKD: 'North Macedonia', MLT: 'Malta', MNE: 'Montenegro', NED: 'Netherlands',
  NIR: 'Northern Ireland', NOR: 'Norway', POL: 'Poland', POR: 'Portugal', ROU: 'Romania',
  SCO: 'Scotland', SRB: 'Serbia', SUI: 'Switzerland', SVK: 'Slovakia', SVN: 'Slovenia',
  SWE: 'Sweden', TUR: 'Turkey', UKR: 'Ukraine', WAL: 'Wales'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[đĐ]/g, 'd').replace(/[øØ]/g, 'o').replace(/[ħĦ]/g, 'h').replace(/[ıİ]/g, 'i')
  .replace(/[łŁ]/g, 'l').replace(/[ßẞ]/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[þÞðÐ]/g, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* Mots à ignorer quand on compare deux noms de club. */
const NOISE = /\b(fc|fk|sk|ac|as|af|cf|cs|sc|bk|if|kf|nk|hnk|gnk|pfc|ubk|kv|rc|ks|ss|sv|us|ca|club|de|f|c|s|k|a|1|fotboll|football|futbol|fussball|calcio|team|men|women)\b/g;
const core = s => norm(s).replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

function score(club, cand) {
  const a = core(club.name), b = core(cand.name || '');
  let sc = 0;
  if (!a || !b) return 0;
  if (a === b) sc = 100;
  else if (b.startsWith(a) || a.startsWith(b)) sc = 80;
  else if (b.includes(a) || a.includes(b)) sc = 65;
  else {
    const wa = new Set(a.split(' ')), wb = new Set(b.split(' '));
    const hit = [...wa].filter(w => wb.has(w) && w.length > 2).length;
    sc = hit ? 40 + hit * 10 : 0;
  }
  const want = SM_COUNTRY[club.cc];
  const got = cand.country?.name;
  if (want && got) sc += norm(got) === norm(want) ? 25 : -45;
  if (cand.gender && cand.gender !== 'male') sc -= 60;
  if (cand.placeholder) sc -= 30;
  return sc;
}

async function api(path, params = {}) {
  const u = new URL(API + path);
  u.searchParams.set('api_token', TOKEN);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if (r.status === 429) { await sleep(4000); return api(path, params); }
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`image → HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 200) throw new Error('image vide');
  await writeFile(dest, buf);
  return buf.length;
}

const exists = async p => { try { await access(p); return true; } catch { return false; } };

/* ------------------------------------------------------------------------ */
const clubs = JSON.parse(await readFile(join(ROOT, 'data/clubs.json'), 'utf8'));
let overrides = {};
try { overrides = JSON.parse(await readFile(join(ROOT, 'tools/logo-overrides.json'), 'utf8')); } catch {}
await mkdir(join(ROOT, 'logos'), { recursive: true });

const map = {}, report = [];
let done = 0, skipped = 0, failed = 0, shaky = 0;

for (const club of clubs) {
  if (ONLY && club.id !== ONLY) continue;
  const dest = join(ROOT, 'logos', club.id + '.png');
  const rel = 'logos/' + club.id + '.png';

  if (!FORCE && await exists(dest)) { map[club.id] = rel; skipped++; continue; }

  try {
    const ov = overrides[club.id];
    let url = null, matched = null, conf = 'override';

    if (typeof ov === 'string' && /^https?:/.test(ov)) {
      url = ov;
    } else if (ov != null) {
      const t = (await api(`/teams/${ov}`)).data;
      url = t?.image_path; matched = t?.name;
    } else {
      const q = encodeURIComponent(club.name.replace(/[().]/g, ' ').trim());
      const res = await api(`/teams/search/${q}`, { include: 'country' });
      const cands = (res.data || []).map(c => ({ c, s: score(club, c) })).sort((a, b) => b.s - a.s);
      const best = cands[0];
      if (!best || best.s < 45) throw new Error('aucune correspondance convaincante' +
        (cands.length ? ` (meilleur : « ${cands[0].c.name} », score ${cands[0].s})` : ''));
      url = best.c.image_path; matched = best.c.name;
      conf = best.s >= 100 ? 'sûr' : best.s >= 75 ? 'probable' : 'à vérifier';
      if (conf === 'à vérifier') shaky++;
      await sleep(140);
    }

    if (!url) throw new Error('pas d’image côté Sportmonks');
    const size = await download(url, dest);
    map[club.id] = rel;
    report.push({ id: club.id, club: club.name, pays: club.country, sportmonks: matched, confiance: conf, url, octets: size });
    done++;
    console.log(`  ✓ ${club.name.padEnd(26)} ← ${String(matched ?? url).slice(0, 34).padEnd(34)} [${conf}]`);
  } catch (e) {
    failed++;
    report.push({ id: club.id, club: club.name, pays: club.country, erreur: String(e.message) });
    console.log(`  ✖ ${club.name.padEnd(26)} ${e.message}`);
  }
}

/* On conserve les entrées déjà connues pour ne pas perdre les logos existants. */
let prev = {};
try { prev = JSON.parse(await readFile(join(ROOT, 'data/logos.json'), 'utf8')); } catch {}
await writeFile(join(ROOT, 'data/logos.json'), JSON.stringify({ ...prev, ...map }, null, 1) + '\n');
await writeFile(join(ROOT, 'tools/logo-report.json'), JSON.stringify(report, null, 1) + '\n');

console.log(`\n${done} téléchargés · ${skipped} déjà présents · ${failed} en échec` +
  (shaky ? ` · ${shaky} à vérifier dans tools/logo-report.json` : ''));
if (failed) console.log('Pour les échecs : renseignez tools/logo-overrides.json puis relancez.');
