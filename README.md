# GeoConf — Le GeoGuessr du football

> Les clubs de Conference League, pour les hipsters.

Un club s'affiche. Vous le placez sur une carte d'Europe épurée. **Chaque kilomètre
d'écart vaut un point — et le meilleur score est le plus petit.**

Site statique, sans dépendance, sans build. Fait pour être hébergé sur GitHub Pages
et intégré en `<iframe>` (900 px de large maximum).

---

## Ce qu'il y a dedans

- **121 clubs**, 48 pays, de Beer-Sheva à Bodø et de Kópavogur à Almaty.
- **5 éditions** jouables : 2021/22, 2022/23, 2023/24, 2024/25, 2025/26 — la phase de
  groupes (32 clubs) puis la phase de ligue (36 clubs). L'édition **2026/27** est
  prévue mais reste à renseigner (voir plus bas).
- Éditions **cumulables** : cochez celles que vous voulez, ou « Tout mélanger ».
- **10, 20, 50 ou tous** les clubs par partie. Tirage **sans remise** : un club donné
  ne peut pas retomber dans la même partie.
- Carte **SVG maison** avec zoom/dézoom (molette, pincement, double-clic, boutons) et
  déplacement à la souris ou au doigt.
- Score en kilomètres orthodromiques, verdict par manche, récapitulatif et
  **boutons de partage** (copie, X, WhatsApp, Bluesky, Facebook, partage natif mobile).

## Essayer en local

```bash
node tools/serve.mjs
```

Puis ouvrez <http://localhost:8412>. Le jeu charge ses données en `fetch`, il lui faut
donc un vrai serveur HTTP — ouvrir `index.html` en `file://` ne marchera pas.

## Mise en ligne (GitHub Pages)

1. Poussez le dépôt sur GitHub.
2. *Settings → Pages → Build and deployment → Source* : **GitHub Actions**.
3. Le workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publie tout
   le dépôt à chaque `push` sur `main`.

## Intégration en iframe

```html
<div style="max-width:900px;margin:0 auto">
  <iframe id="geoconf"
          src="https://VOTRE-COMPTE.github.io/VOTRE-DEPOT/"
          title="GeoConf — le GeoGuessr du football"
          style="width:100%;height:900px;border:0;border-radius:18px"
          loading="lazy" allow="clipboard-write; web-share"></iframe>
</div>
<script>
  addEventListener('message', function (e) {
    var f = document.getElementById('geoconf');
    if (e.source !== f.contentWindow || !e.data || e.data.type !== 'geoconf:height') return;
    f.style.height = Math.max(600, e.data.height + 8) + 'px';
  });
</script>
```

Le jeu envoie sa hauteur au parent via `postMessage`, ce qui évite la barre de
défilement interne. Sans ce script, une hauteur fixe de ~1 250 px couvre tous les écrans.
Voir [`embed.html`](embed.html) pour une démo complète.

### Paramètres d'URL

| Paramètre | Effet | Exemple |
|---|---|---|
| `s` | Éditions présélectionnées (séparées par des virgules) | `?s=2024-25,2025-26` |
| `n` | Nombre de clubs : `10`, `20`, `50` ou `0` (tous) | `?n=20` |
| `share` | URL à utiliser dans le texte de partage — mettez-y l'adresse de **votre** page plutôt que celle de l'iframe | `?share=https://exemple.fr/jeu` |

## Les logos des clubs (Sportmonks)

Le jeu est **statique** : une clé API embarquée dans le JavaScript serait lisible par
tout le monde. Les logos sont donc téléchargés **une fois sur votre machine**, puis
commités dans `logos/`. La clé ne quitte jamais votre poste.

```bash
export SPORTMONKS_TOKEN="votre-cle"
node tools/fetch-logos.mjs
```

Le script écrit les images dans `logos/<id-du-club>.png`, met à jour `data/logos.json`
et produit `tools/logo-report.json` avec un niveau de confiance par correspondance.
**Relisez les lignes « à vérifier »** : un club peut être confondu avec son homonyme.

Pour corriger un club, renseignez `tools/logo-overrides.json` puis relancez :

```json
{
  "pafos-fc": 12345,
  "ki-klaksvik": "https://exemple.org/logo.png"
}
```

Options : `--force` (retélécharge tout), `--only=<id-du-club>` (un seul club).

Tant qu'un logo est absent, le jeu affiche un **écusson de repli** généré à la volée
(monogramme sur fond coloré, dérivé de l'identifiant du club). Le jeu est donc
parfaitement jouable sans aucun logo.

## Ajouter l'édition 2026/27

1. Listez les 36 clubs dans `tools/season-2026-27.txt`, un par ligne. Le code pays
   après `|` est facultatif mais fiabilise la résolution :

   ```
   Pafos FC | CYP
   Rayo Vallecano | ESP
   ```

2. Lancez le résolveur :

   ```bash
   node tools/build-season.mjs 2026-27
   ```

   Il reconnaît les clubs déjà présents dans `data/clubs.json` (référencés par leur
   `id`) et va chercher les nouveaux sur Wikipédia puis Wikidata — coordonnées du
   stade (`P115` → `P625`), à défaut le siège (`P159`). Les entrées incertaines sont
   signalées à la fin : **relisez-les**.

3. Vérifiez `data/season-2026-27.json`. L'édition apparaît automatiquement sur
   l'écran d'accueil dès que la liste n'est plus vide.

Vous pouvez aussi remplir `data/season-2026-27.json` à la main — le format est
documenté en tête du fichier.

## Origine des données

- **Composition des phases de groupes / de ligue** : articles Wikipédia des cinq
  éditions (tableaux des chapeaux de tirage), extraits automatiquement.
- **Coordonnées** : Wikidata — stade du club (`P115` → `P625`), sinon siège (`P159`).
  Ce sont donc les coordonnées du **stade**, pas du centre-ville.
- **Fond de carte** : Natural Earth 1:50m via `world-atlas`, découpé sur l'emprise
  du jeu, simplifié (Douglas-Peucker, ~0,5 km) et projeté en Web Mercator.
  449 Ko bruts, ~157 Ko une fois servis en gzip. Le script de génération est
  `tools/build-map.py` (Python 3, aucune dépendance) : il télécharge le TopoJSON,
  déroule les anneaux qui franchissent l'antiméridien, découpe au rectangle
  (Sutherland–Hodgman), simplifie et arrondit.

  L'emprise déborde volontairement de la zone de jeu (lon −33→90, lat 6→80) :
  sur un écran en portrait, la carte affiche une bande plus haute que large, et
  sans cette marge on verrait le bord du découpage trancher le Sahara.

Les coordonnées des 121 clubs ont été recoupées avec le fond de carte : 111 tombent
exactement dans le bon pays. Les 10 autres sont des stades littoraux (Beşiktaş sur le
Bosphore, Djurgården dans l'archipel de Stockholm, Molde sur son fjord, Bodø, KÍ
Klaksvík…) que le trait de côte au 1:50 000e place 1 à 3 km au large. Les coordonnées
sont justes, c'est la carte qui n'a pas la finesse — visible seulement au zoom maximal.

### Quelques cas particuliers, assumés

La bonne réponse est toujours le **domicile historique du club**, pas son stade
d'exil. Ces clubs affichent une note explicative au moment du verdict :

- **Chakhtar Donetsk** → Donetsk, et **Zorya Louhansk** → Louhansk : en exil depuis 2014.
- **Qarabağ** → Bakou : le club vient d'Aghdam, exilé depuis 1993 (les coordonnées
  pointent vers son stade actuel de Bakou).
- **Anorthosis Famagouste** → Larnaca : réfugié depuis 1974.
- **The New Saints** → Oswestry : club gallois dont le stade est en Angleterre.

Si un arbitrage ne vous convient pas, tout est dans `data/clubs.json` — un club, une
ligne, `lat`/`lon`/`city`/`note`.

## Structure

```
index.html                 le jeu (écran d'accueil, partie, résultats)
embed.html                 démo d'intégration en iframe
assets/map.js              moteur de carte : projection, zoom/pan, marqueurs
assets/app.js              logique de jeu, score, partage
assets/style.css           thème sombre
data/clubs.json            121 clubs : nom, ville, pays, coordonnées, éditions
data/seasons.json          les six éditions
data/season-2026-27.json   à compléter
data/europe.json           fond de carte
data/logos.json            id du club → chemin du logo
logos/                     images téléchargées via Sportmonks
tools/fetch-logos.mjs      récupération des logos (clé API locale)
tools/build-season.mjs     construction d'une édition depuis une liste de noms
tools/serve.mjs            serveur statique pour tester en local
```

## Licence & crédits

Code : faites-en ce que vous voulez.
Données : Wikipédia / Wikidata (CC BY-SA), Natural Earth (domaine public).
Logos : Sportmonks — vérifiez les conditions de votre abonnement avant publication.
