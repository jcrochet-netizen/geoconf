# GeoConf — Le GeoGuessr du football

> Les clubs de Conference League, pour les hipsters.

Un club s'affiche. Vous le placez sur une carte d'Europe épurée. **Chaque kilomètre
d'écart vaut un point — et le meilleur score est le plus petit.**

Site statique, sans dépendance, sans build. Fait pour être hébergé sur GitHub Pages
et intégré en `<iframe>` (900 px de large maximum).

---

## Ce qu'il y a dedans

- **143 clubs**, 51 pays, sur 6 200 km d'est en ouest.
- **6 éditions** jouables : 2021/22 → 2026/27 — la phase de groupes (32 clubs) puis
  la phase de ligue (36 clubs).
- **Le pays du club n'est jamais affiché** : ce serait trop facile. Trois **indices**
  par partie permettent de l'acheter, et une fois dépensés il n'y en a plus.
- Éditions **cumulables** : cochez celles que vous voulez, ou « Tout mélanger ».
- **10, 20, 50 ou tous** les clubs par partie. Tirage **sans remise** : un club donné
  ne peut pas retomber dans la même partie.
- Carte **SVG maison** avec zoom/dézoom (molette, pincement, double-clic, boutons) et
  déplacement à la souris ou au doigt.
- Score en kilomètres orthodromiques, verdict par manche, récapitulatif et
  **boutons de partage** (copie, X, WhatsApp, Bluesky, Facebook, partage natif mobile).
  Le texte partagé indique combien d'indices ont été consommés.

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

## Ajouter ou corriger une édition

L'édition 2026/27 est déjà intégrée à `data/clubs.json`. Pour une édition suivante
(ou pour corriger une liste), la mécanique est la même :

1. Listez les clubs dans `tools/season-2027-28.txt`, un par ligne. Le code pays
   après `|` est facultatif mais fiabilise la résolution :

   ```
   Pafos FC | CYP
   Rayo Vallecano | ESP
   ```

2. Lancez le résolveur :

   ```bash
   node tools/build-season.mjs 2027-28
   ```

   Il reconnaît les clubs déjà présents dans `data/clubs.json` (référencés par leur
   `id`) et va chercher les nouveaux sur Wikipédia puis Wikidata — coordonnées du
   stade (`P115` → `P625`), à défaut le siège (`P159`). Les appels sont groupés par
   paquets de 40, sans quoi Wikidata répond des HTTP 429.

3. **Relisez la sortie.** Le script signale les titres approchés, les villes et pays
   manquants, et vérifie le sport de l'entité (`P641`) — sans ce garde-fou,
   « Kauno Žalgiris » redirige vers le club de *basket* de Kaunas et récupère les
   coordonnées de la Žalgiris Arena. Une redirection Wikipédia peut mener n'importe où.

4. Ajoutez l'édition à `data/seasons.json`. Elle apparaît sur l'écran d'accueil dès
   qu'au moins un club la référence.

Vous pouvez aussi remplir `data/season-<édition>.json` à la main — le format est
documenté en tête du fichier — ou éditer directement `data/clubs.json`, une ligne
par club.

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

Les coordonnées ont été recoupées avec le fond de carte : sur les 121 clubs des cinq
premières éditions, 111 tombent exactement dans le bon pays. Les 10 autres sont des stades littoraux (Beşiktaş sur le
Bosphore, Djurgården dans l'archipel de Stockholm, Molde sur son fjord, Bodø, KÍ
Klaksvík…) que le trait de côte au 1:50 000e place 1 à 3 km au large. Les coordonnées
sont justes, c'est la carte qui n'a pas la finesse — visible seulement au zoom maximal.

### Quelques cas particuliers, assumés

La bonne réponse est toujours le **domicile historique du club**, pas son stade
d'exil. Ces clubs affichent une note explicative au moment du verdict :

- **Chakhtar Donetsk** → Donetsk, et **Zorya Louhansk** → Louhansk. Les quatre clubs
  ukrainiens (avec le Dynamo Kyiv et le Dnipro-1) sont placés à leur stade **en
  Ukraine**, jamais à leur lieu d'exil.
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
data/clubs.json            143 clubs : nom, ville, pays, coordonnées, éditions
data/seasons.json          les six éditions
data/season-2026-27.json   fichier d'appoint (vide : l'édition est dans clubs.json)
data/europe.json           fond de carte
data/logos.json            id du club → chemin du logo
logos/                     images téléchargées via Sportmonks
tools/fetch-logos.mjs      récupération des logos (clé API locale)
tools/build-season.mjs     construction d'une édition depuis une liste de noms
tools/build-map.py         régénération du fond de carte
tools/serve.mjs            serveur statique pour tester en local
```

## Licence & crédits

Code : faites-en ce que vous voulez.
Données : Wikipédia / Wikidata (CC BY-SA), Natural Earth (domaine public).
Logos : Sportmonks — vérifiez les conditions de votre abonnement avant publication.
