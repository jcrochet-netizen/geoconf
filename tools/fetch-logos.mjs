#!/usr/bin/env node
/* ============================================================================
   Récupère les logos officiels des clubs via l'API Sportmonks.

   Le jeu est un site statique : une clé API dans le JavaScript serait lisible
   par tout le monde. Ce script tourne sur VOTRE machine, télécharge les images
   une bonne fois pour toutes, et c'est le dossier logos/ qui part sur GitHub.

     export SPORTMONKS_TOKEN="votre-cle"     (ou un fichier .env à la racine)
     node tools/fetch-logos.mjs              # tous les clubs manquants
     node tools/fetch-logos.mjs --dry-run    # cherche sans rien télécharger
     node tools/fetch-logos.mjs --force      # re-télécharge tout
     node tools/fetch-logos.mjs --only=ajax  # un seul club
     node tools/fetch-logos.mjs --terms      # montre les termes cherchés (hors ligne)

   Beaucoup de clubs sont obscurs et portent chez nous un nom français
   (« Étoile rouge de Belgrade ») que Sportmonks ne connaît pas. Le script
   essaie donc plusieurs termes par club — titre Wikipédia anglais d'abord,
   puis variantes sans accents — et s'arrête dès qu'une correspondance est sûre.

   Relisez tools/logo-report.json : les lignes « à vérifier » méritent un œil.
   Pour corriger un club, renseignez tools/logo-overrides.json puis relancez.
   ========================================================================== */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.sportmonks.com/v3/football';
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').split('=')[1];
const TERMS_ONLY = args.includes('--terms');   // inspection hors ligne

/* ── clé : variable d'environnement, sinon .env à la racine ──────────────── */
let TOKEN = process.env.SPORTMONKS_TOKEN || process.env.SPORTMONKS_API_TOKEN;
if (!TOKEN) {
  try {
    const env = await readFile(join(ROOT, '.env'), 'utf8');
    const m = env.match(/^\s*SPORTMONKS_(?:API_)?TOKEN\s*=\s*["']?([^"'\r\n]+)/m);
    if (m) TOKEN = m[1].trim();
  } catch {}
}
if (!TOKEN && !TERMS_ONLY) {
  console.error('✖ Clé Sportmonks introuvable.\n' +
    '  export SPORTMONKS_TOKEN="votre-cle"\n' +
    '  ou créez un fichier .env à la racine : SPORTMONKS_TOKEN=votre-cle\n' +
    '  (.env est déjà dans .gitignore, il ne partira pas sur GitHub)');
  process.exit(1);
}

/* Nom de pays tel que Sportmonks le renvoie, par code UEFA. */
const SM_COUNTRY = {
  ALB: 'Albania', AND: 'Andorra', ARM: 'Armenia', AUT: 'Austria', AZE: 'Azerbaijan',
  BEL: 'Belgium', BIH: 'Bosnia and Herzegovina', BLR: 'Belarus', BUL: 'Bulgaria',
  CRO: 'Croatia', CYP: 'Cyprus', CZE: 'Czech Republic', DEN: 'Denmark', ENG: 'England',
  ESP: 'Spain', EST: 'Estonia', FIN: 'Finland', FRA: 'France', FRO: 'Faroe Islands',
  GEO: 'Georgia', GER: 'Germany', GIB: 'Gibraltar', GRE: 'Greece', HUN: 'Hungary',
  IRL: 'Ireland', ISL: 'Iceland', ISR: 'Israel', ITA: 'Italy', KAZ: 'Kazakhstan',
  KOS: 'Kosovo', LIE: 'Liechtenstein', LTU: 'Lithuania', LUX: 'Luxembourg', LVA: 'Latvia',
  MDA: 'Moldova', MKD: 'North Macedonia', MLT: 'Malta', MNE: 'Montenegro',
  NED: 'Netherlands', NIR: 'Northern Ireland', NOR: 'Norway', POL: 'Poland',
  POR: 'Portugal', ROU: 'Romania', SCO: 'Scotland', SRB: 'Serbia', SUI: 'Switzerland',
  SVK: 'Slovakia', SVN: 'Slovenia', SWE: 'Sweden', TUR: 'Turkey', UKR: 'Ukraine',
  WAL: 'Wales'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Retire la clé de tout texte avant affichage ou écriture sur disque. */
const safe = m => String(m)
  .split(TOKEN).join('***')
  .replace(/api_token=[^&\s"']+/gi, 'api_token=***');

/** Réduit une chaîne à de l'ASCII minuscule : Ħamrun → hamrun, Žalgiris → zalgiris. */
const ascii = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[đĐ]/g, 'd').replace(/[øØ]/g, 'o').replace(/[ħĦ]/g, 'h').replace(/[ıİ]/g, 'i')
  .replace(/[łŁ]/g, 'l').replace(/[ßẞ]/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[þÞ]/g, 'th')
  .replace(/[ðÐ]/g, 'd').replace(/[œŒ]/g, 'oe');
const norm = s => ascii(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* Mots à ignorer quand on compare deux noms de club. */
const NOISE = /\b(fc|fk|sk|ac|as|af|cf|cs|sc|bk|if|kf|nk|hnk|gnk|pfc|ubk|kv|rc|ks|ss|sv|us|ca|vv|jk|aif|club|de|du|la|le|of|and|f|c|s|k|a|fotboll|football|futbol|fussball|calcio|fodbold|team|men|women|ii|b)\b/g;
const core = s => norm(s).replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

/** Les termes de recherche à tenter, du plus prometteur au plus large. */
function searchTerms(club) {
  const out = [];
  const add = s => {
    s = String(s || '').replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s*\b(F\.?C\.?|A\.?F\.?C\.?|S\.?C\.?|B\.?C\.?|V\.?V\.?)\s*$/i, '')
      .replace(/\s+/g, ' ').trim();
    if (s.length > 1 && !out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s);
  };
  add(club.wiki);              // titre anglais : le plus proche de Sportmonks
  add(club.name);              // notre nom d'affichage, souvent francisé
  add(ascii(club.wiki));       // sans accents, au cas où la recherche bute dessus
  add(ascii(club.name));
  const c = core(club.wiki);   // dernier recours : le noyau distinctif
  if (c && c.split(' ').length <= 3) add(c);
  return out.slice(0, 4);      // on ne brûle pas le quota d'appels
}

/** 0-125. Compare le candidat aux DEUX noms connus du club, garde le meilleur. */
function score(club, cand) {
  const bName = norm(cand.name || '');
  const bCore = core(cand.name || '');
  if (!bName) return 0;
  let best = 0;
  for (const ours of [club.name, club.wiki]) {
    const aName = norm(ours), aCore = core(ours);
    let s = 0;
    if (aName === bName) s = 100;
    else if (aCore && aCore === bCore) s = 96;
    else if (bName.startsWith(aName) || aName.startsWith(bName)) s = 82;
    else if (bCore && aCore && (bCore.startsWith(aCore) || aCore.startsWith(bCore))) s = 78;
    else if (bName.includes(aName) || aName.includes(bName)) s = 66;
    else {
      const wa = new Set(aCore.split(' ').filter(w => w.length > 2));
      const wb = new Set(bCore.split(' ').filter(w => w.length > 2));
      const hit = [...wa].filter(w => wb.has(w)).length;
      s = hit ? 42 + hit * 12 : 0;
    }
    if (s > best) best = s;
  }
  const want = SM_COUNTRY[club.cc];
  const got = cand.country?.name;
  if (want && got) best += norm(got) === norm(want) ? 25 : -50;   // le pays tranche
  if (cand.gender && cand.gender !== 'male') best -= 70;
  if (cand.placeholder) best -= 35;
  return best;
}

async function api(path, params = {}) {
  const u = new URL(API + path);
  u.searchParams.set('api_token', TOKEN);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let a = 0; a < 4; a++) {
    const r = await fetch(u, { headers: { accept: 'application/json' } });
    if (r.status === 429) { await sleep(5000 * (a + 1)); continue; }
    if (r.status === 404) return { data: [] };
    if (!r.ok) throw new Error(safe(`HTTP ${r.status} ${(await r.text()).slice(0, 140)}`));
    return r.json();
  }
  throw new Error('429 après 4 tentatives — quota horaire atteint');
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`image HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 300) throw new Error('image vide ou factice');
  const isPng = buf.subarray(0, 4).equals(PNG);
  const isSvg = buf.subarray(0, 300).toString('utf8').includes('<svg');
  if (!isPng && !isSvg && !buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    throw new Error('ce n’est pas une image');
  await writeFile(dest, buf);
  return buf.length;
}

const exists = async p => { try { await access(p); return true; } catch { return false; } };
const pad = (s, n) => String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s).padEnd(n);

/* ------------------------------------------------------------------------ */
const clubs = JSON.parse(await readFile(join(ROOT, 'data/clubs.json'), 'utf8'));
let overrides = {};
try { overrides = JSON.parse(await readFile(join(ROOT, 'tools/logo-overrides.json'), 'utf8')); } catch {}
if (!DRY) await mkdir(join(ROOT, 'logos'), { recursive: true });

const targets = clubs.filter(c => !ONLY || c.id === ONLY);

if (TERMS_ONLY) {
  for (const c of targets) console.log(pad(c.name, 28) + '→  ' + searchTerms(c).join('  |  '));
  console.log(`\n${targets.length} clubs · ${targets.reduce((n, c) => n + searchTerms(c).length, 0)} termes ` +
              `(au pire ${targets.reduce((n, c) => n + searchTerms(c).length, 0)} appels ; ` +
              `beaucoup moins en pratique, on s'arrête au premier match sûr)`);
  process.exit(0);
}
console.log(`${targets.length} club(s) à traiter${DRY ? '  ·  MODE SIMULATION, aucun téléchargement' : ''}\n`);

const map = {}, report = [];
let ok = 0, skipped = 0, failed = 0, shaky = 0, calls = 0;

for (const club of targets) {
  const dest = join(ROOT, 'logos', club.id + '.png');
  const rel = 'logos/' + club.id + '.png';

  if (!FORCE && !DRY && await exists(dest)) { map[club.id] = rel; skipped++; continue; }

  try {
    const ov = overrides[club.id];
    let url = null, matched = null, sc = null, conf = 'forcé', via = 'override';

    if (typeof ov === 'string' && /^https?:/.test(ov)) {
      url = ov; matched = '(URL directe)';
    } else if (typeof ov === 'number') {
      const t = (await api(`/teams/${ov}`)).data; calls++;
      url = t?.image_path; matched = t?.name;
    } else {
      let best = null;
      for (const term of searchTerms(club)) {
        const res = await api(`/teams/search/${encodeURIComponent(term)}`, { include: 'country' });
        calls++;
        for (const cand of res.data || []) {
          const s = score(club, cand);
          if (!best || s > best.s) best = { s, cand, term };
        }
        if (best && best.s >= 95) break;       // inutile de chercher plus loin
        await sleep(130);
      }
      if (!best || best.s < 50) {
        throw new Error(best
          ? `pas de correspondance fiable (meilleur : « ${best.cand.name} », score ${best.s})`
          : 'aucun résultat de recherche');
      }
      url = best.cand.image_path;
      matched = best.cand.name;
      sc = best.s; via = best.term;
      conf = best.s >= 95 ? 'sûr' : best.s >= 75 ? 'probable' : 'à vérifier';
      if (conf === 'à vérifier') shaky++;
    }

    if (!url) throw new Error('pas d’image côté Sportmonks');

    let bytes = null;
    if (!DRY) { bytes = await download(url, dest); map[club.id] = rel; }
    ok++;
    report.push({ id: club.id, club: club.name, pays: club.country, sportmonks: matched,
                  confiance: conf, score: sc, terme: via, url, octets: bytes });
    console.log(`  ${conf === 'sûr' ? '✓' : conf === 'probable' ? '·' : '⚠'} ${pad(club.name, 26)} ← ${pad(matched, 28)} [${conf}]`);
  } catch (e) {
    failed++;
    report.push({ id: club.id, club: club.name, pays: club.country, erreur: safe(e.message) });
    console.log(`  ✖ ${pad(club.name, 26)} ${safe(e.message)}`);
  }
}

if (!DRY) {
  let prev = {};
  try { prev = JSON.parse(await readFile(join(ROOT, 'data/logos.json'), 'utf8')); } catch {}
  await writeFile(join(ROOT, 'data/logos.json'), JSON.stringify({ ...prev, ...map }, null, 1) + '\n');
}
await writeFile(join(ROOT, 'tools/logo-report.json'), JSON.stringify(report, null, 1) + '\n');

console.log(`\n${ok} trouvé(s) · ${skipped} déjà présent(s) · ${failed} en échec` +
            `  —  ${calls} appels API consommés`);
if (shaky) console.log(`⚠ ${shaky} correspondance(s) « à vérifier » dans tools/logo-report.json`);
if (failed) console.log('Pour les échecs : ajoutez le club à tools/logo-overrides.json puis relancez.');
if (DRY) console.log('\nSimulation terminée — relancez sans --dry-run pour télécharger.');
