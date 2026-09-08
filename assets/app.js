/* ============================================================================
   GeoConf — Le GeoGuessr du football (Conference League)
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var COUNT_OPTIONS = [10, 20, 50, 0];   // 0 = tous
  var HINTS_PER_GAME = 3;                // indices offerts par partie

  var COUNTRY_NAMES = {
    ALB: ['Albanie', '🇦🇱'], AND: ['Andorre', '🇦🇩'],
    ARM: ['Arménie', '🇦🇲'], AUT: ['Autriche', '🇦🇹'], AZE: ['Azerbaïdjan', '🇦🇿'], BEL: ['Belgique', '🇧🇪'],
    BIH: ['Bosnie-Herzégovine', '🇧🇦'], BLR: ['Biélorussie', '🇧🇾'], BUL: ['Bulgarie', '🇧🇬'], CRO: ['Croatie', '🇭🇷'],
    CYP: ['Chypre', '🇨🇾'], CZE: ['Tchéquie', '🇨🇿'], DEN: ['Danemark', '🇩🇰'], ENG: ['Angleterre', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'],
    ESP: ['Espagne', '🇪🇸'], EST: ['Estonie', '🇪🇪'], FIN: ['Finlande', '🇫🇮'], FRA: ['France', '🇫🇷'],
    FRO: ['Îles Féroé', '🇫🇴'], GEO: ['Géorgie', '🇬🇪'], GER: ['Allemagne', '🇩🇪'], GIB: ['Gibraltar', '🇬🇮'],
    GRE: ['Grèce', '🇬🇷'], HUN: ['Hongrie', '🇭🇺'], IRL: ['Irlande', '🇮🇪'], ISL: ['Islande', '🇮🇸'],
    ISR: ['Israël', '🇮🇱'], ITA: ['Italie', '🇮🇹'], KAZ: ['Kazakhstan', '🇰🇿'], KOS: ['Kosovo', '🇽🇰'],
    LIE: ['Liechtenstein', '🇱🇮'], LTU: ['Lituanie', '🇱🇹'], LUX: ['Luxembourg', '🇱🇺'], LVA: ['Lettonie', '🇱🇻'],
    MDA: ['Moldavie', '🇲🇩'], MKD: ['Macédoine du Nord', '🇲🇰'], MLT: ['Malte', '🇲🇹'], MNE: ['Monténégro', '🇲🇪'],
    NED: ['Pays-Bas', '🇳🇱'], NIR: ['Irlande du Nord', '🏴'], NOR: ['Norvège', '🇳🇴'], POL: ['Pologne', '🇵🇱'],
    POR: ['Portugal', '🇵🇹'], ROU: ['Roumanie', '🇷🇴'], SCO: ['Écosse', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'], SRB: ['Serbie', '🇷🇸'],
    SUI: ['Suisse', '🇨🇭'], SVK: ['Slovaquie', '🇸🇰'], SVN: ['Slovénie', '🇸🇮'], SWE: ['Suède', '🇸🇪'],
    TUR: ['Turquie', '🇹🇷'], UKR: ['Ukraine', '🇺🇦'], WAL: ['Pays de Galles', '🏴󠁧󠁢󠁷󠁬󠁳󠁿']
  };

  var BUCKETS = [
    { max: 25,    sq: '⭐', label: 'Dans le rond central', cls: 'b-ace' },
    { max: 100,   sq: '🟩', label: 'Excellent',            cls: 'b-great' },
    { max: 300,   sq: '🟨', label: 'Solide',               cls: 'b-good' },
    { max: 750,   sq: '🟧', label: 'Approximatif',         cls: 'b-meh' },
    { max: 2000,  sq: '🟥', label: 'Perdu',                cls: 'b-bad' },
    { max: Infinity, sq: '⬛', label: 'Catastrophe industrielle', cls: 'b-awful' }
  ];
  function bucket(km) { for (var i = 0; i < BUCKETS.length; i++) if (km < BUCKETS[i].max) return BUCKETS[i]; }

  var RANKS = [
    [100,  'Scout international', 'Vous avez vu jouer le Petrocub Hîncești en vrai, avouez.'],
    [200,  'Recruteur confirmé', 'Vous savez ce qu\'est un tour préliminaire.'],
    [400,  'Abonné à la 3e chaîne du bouquet', 'Le jeudi soir n\'a plus de secret pour vous.'],
    [700,  'Supporter du dimanche', 'L\'Europe de l\'Est reste un grand flou artistique.'],
    [1200, 'Bratislava, Bucarest, même combat', 'Il va falloir réviser la carte.'],
    [Infinity, 'La géographie attendra', 'Mais le maillot était joli.']
  ];
  function rankFor(avg) { for (var i = 0; i < RANKS.length; i++) if (avg < RANKS[i][0]) return RANKS[i]; }

  var CREST_STOP = /^(fc|fk|sk|ac|as|af|cf|cs|sc|bk|if|kf|nk|hnk|gnk|pfc|ubk|kv|rc|ogc|ks|ss|sv|us|ca|club|the|1|1\.|f\.c\.|s\.k\.|a\.c\.|r\.s\.c\.|k\.r\.c\.|kaa|krc|rsc|hsk|hšk|šk|nš|apoel|aek|paok)$/i;

  var S = {
    clubs: [], seasons: [], logos: {},
    sel: {}, count: 10,
    deck: [], idx: 0, results: [], guess: null, revealed: false, map: null,
    hintsLeft: 0, hintUsed: false, hintsSpent: 0
  };

  /* ---------- utilitaires ---------- */
  function fmtKm(km) {
    var v = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
    return v.toLocaleString('fr-FR');
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

  function initials(name) {
    var words = name.replace(/[().]/g, ' ').split(/[\s/·-]+/).filter(Boolean);
    var keep = words.filter(function (w) { return !CREST_STOP.test(w); });
    if (!keep.length) keep = words;
    var out = keep.slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
    if (out.length < 2 && keep[0]) out = keep[0].slice(0, 2).toUpperCase();
    return out || '??';
  }

  function crestHTML(club) {
    // On ne demande une image que si data/logos.json la déclare : sans cela, chaque
    // manche déclencherait un 404 tant que tools/fetch-logos.mjs n'a pas tourné.
    var src = S.logos[club.id];
    var h = hash(club.id) % 360;
    var fb = '<span class="crest-fb" style="--h:' + h + '">' + initials(club.name) + '</span>';
    return (src ? '<img alt="" src="' + src + '" loading="eager" onerror="this.remove()">' : '') + fb;
  }

  /* ---------- écran d'accueil ---------- */
  function poolFor(sel) {
    var ids = Object.keys(sel).filter(function (k) { return sel[k]; });
    if (!ids.length) return [];
    return S.clubs.filter(function (c) {
      for (var i = 0; i < ids.length; i++) if (c.seasons.indexOf(ids[i]) >= 0) return true;
      return false;
    });
  }

  function renderSeasons() {
    var box = $('season-chips');
    box.innerHTML = '';
    S.seasons.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.season = s.id;
      var n = S.clubs.filter(function (c) { return c.seasons.indexOf(s.id) >= 0; }).length;
      b.innerHTML = '<span class="chip-main">' + s.label + '</span><span class="chip-sub">' +
                    (n ? n + ' clubs' : 'à venir') + '</span>';
      if (!n) { b.disabled = true; b.title = 'Édition non renseignée — voir data/season-2026-27.json'; }
      b.addEventListener('click', function () {
        S.sel[s.id] = !S.sel[s.id];
        syncHome();
      });
      box.appendChild(b);
    });
  }

  function renderCounts() {
    var box = $('count-chips');
    box.innerHTML = '';
    COUNT_OPTIONS.forEach(function (n) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip chip-num';
      b.dataset.count = n;
      b.innerHTML = '<span class="chip-main">' + (n || 'Tous') + '</span>' +
                    '<span class="chip-sub">' + (n ? 'clubs' : 'le paquet complet') + '</span>';
      b.addEventListener('click', function () { S.count = n; syncHome(); });
      box.appendChild(b);
    });
  }

  function syncHome() {
    var pool = poolFor(S.sel), n = pool.length;
    Array.prototype.forEach.call($('season-chips').children, function (b) {
      b.classList.toggle('is-on', !!S.sel[b.dataset.season]);
    });
    Array.prototype.forEach.call($('count-chips').children, function (b) {
      var c = +b.dataset.count;
      var tooBig = c > 0 && c > n;
      b.classList.toggle('is-on', c === S.count);
      b.classList.toggle('is-dim', tooBig);
      b.disabled = tooBig && n > 0;
      if (tooBig && c === S.count) { S.count = 0; }
    });
    Array.prototype.forEach.call($('count-chips').children, function (b) {
      b.classList.toggle('is-on', +b.dataset.count === S.count);
    });

    var rounds = S.count === 0 ? n : Math.min(S.count, n);
    var picked = S.seasons.filter(function (s) { return S.sel[s.id]; });
    $('pool-info').textContent = n ? n + ' clubs disponibles' : '—';
    $('btn-play').disabled = n === 0;
    var available = S.seasons.filter(function (s) {
      return S.clubs.some(function (c) { return c.seasons.indexOf(s.id) >= 0; });
    });
    $('cta-sub').textContent = n === 0 ? 'Choisissez au moins une édition'
      : rounds + ' manche' + (rounds > 1 ? 's' : '') + ' · ' +
        (picked.length === available.length ? 'toutes les éditions'
                                            : picked.map(function (s) { return s.short; }).join(' · '));
    $('btn-all-seasons').textContent = picked.length > 1 ? 'Tout décocher' : 'Tout mélanger';
  }

  function renderFacts() {
    var n = S.clubs.length;
    var countries = {}, east = null, west = null;
    S.clubs.forEach(function (c) {
      countries[c.cc] = 1;
      if (!east || c.lon > east.lon) east = c;
      if (!west || c.lon < west.lon) west = c;
    });
    var span = Math.round(window.geoUtil.haversine(west, east) / 100) * 100;
    $('home-facts').innerHTML = [
      ['⚽', n + ' clubs', 'phases de groupes & de ligue'],
      ['🌍', Object.keys(countries).length + ' pays', 'représentés'],
      ['📐', span.toLocaleString('fr-FR') + ' km', "d'un bout à l'autre du tableau"]
    ].map(function (f) {
      return '<li><i>' + f[0] + '</i><b>' + f[1] + '</b><span>' + f[2] + '</span></li>';
    }).join('');
  }

  /* ---------- partie ---------- */
  function show(id) {
    ['scr-home', 'scr-play', 'scr-end'].forEach(function (s) {
      $(s).classList.toggle('is-active', s === id);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    postHeight();
  }

  function startGame() {
    var pool = shuffle(poolFor(S.sel).slice());
    var n = S.count === 0 ? pool.length : Math.min(S.count, pool.length);
    S.deck = pool.slice(0, n);      // tirage sans remise : chaque club n'apparaît qu'une fois
    S.idx = 0; S.results = [];
    S.hintsLeft = HINTS_PER_GAME; S.hintUsed = false; S.hintsSpent = 0;
    show('scr-play');
    S.map.resize();
    nextRound();
  }

  function nextRound() {
    if (S.idx >= S.deck.length) return endGame();
    var c = S.deck[S.idx];
    S.guess = null; S.revealed = false; S.hintUsed = false;

    $('crest').innerHTML = crestHTML(c);
    $('club-name').textContent = c.name;
    renderMeta(c, false);

    $('stat-round').innerHTML = (S.idx + 1) + '<i>/' + S.deck.length + '</i>';
    $('progress-bar').style.width = (S.idx / S.deck.length * 100) + '%';
    updateScore();

    S.map.clear();
    S.map.home(true);
    $('verdict').hidden = true;
    $('btn-guess').hidden = false; $('btn-guess').disabled = true;
    $('btn-next').hidden = true;
    syncHint();
    $('map-hint').hidden = false;
    $('map-hint').textContent = S.idx === 0
      ? 'Cliquez sur la carte · molette ou pincement pour zoomer'
      : 'Cliquez sur la carte pour placer votre pronostic';
    $('actionbar').className = 'actionbar';
  }

  /** Le pays reste caché tant que le joueur n'a pas dépensé un indice. */
  function renderMeta(c, showCountry) {
    var seas = c.seasons.filter(function (s) { return S.sel[s]; })
      .map(function (id) {
        var s = S.seasons.filter(function (x) { return x.id === id; })[0];
        return '<b>' + (s ? s.short : id) + '</b>';
      }).join('');
    var ctry = showCountry
      ? '<span class="ctry is-revealed"><span class="flag">' + (c.flag || '') + '</span>' + c.country + '</span>'
      : '';
    $('club-meta').innerHTML = ctry + '<span class="seas">' + seas + '</span>';
  }

  function syncHint() {
    var b = $('btn-hint'), t = b.querySelector('.hint-txt');
    $('hint-left').textContent = S.hintsLeft;
    b.hidden = S.revealed;
    if (S.hintUsed) { b.disabled = true; t.textContent = 'Pays révélé'; }
    else if (S.hintsLeft === 0) { b.disabled = true; t.textContent = 'Plus d\'indice'; }
    else { b.disabled = false; t.textContent = 'Indice'; }
    b.classList.toggle('is-spent', S.hintsLeft === 0 && !S.hintUsed);
  }

  function useHint() {
    if (S.revealed || S.hintUsed || S.hintsLeft <= 0) return;
    S.hintsLeft--; S.hintUsed = true; S.hintsSpent++;
    renderMeta(S.deck[S.idx], true);
    syncHint();
    postHeight();
  }

  function onPick(ll) {
    if (S.revealed) return;
    S.guess = ll;
    S.map.setMarkers([{ lat: ll.lat, lon: ll.lon, kind: 'guess' }]);
    $('btn-guess').disabled = false;
    $('map-hint').textContent = 'Déplacez le point si besoin, puis validez';
  }

  function submit() {
    if (!S.guess || S.revealed) return;
    S.revealed = true;
    var c = S.deck[S.idx];
    var km = window.geoUtil.haversine(S.guess, c);
    var b = bucket(km);
    S.results.push({ club: c, km: km, guess: S.guess, bucket: b });

    S.map.setMarkers([
      { lat: S.guess.lat, lon: S.guess.lon, kind: 'guess', label: 'Vous' },
      { lat: c.lat, lon: c.lon, kind: 'truth', label: c.city }
    ]);
    S.map.setLink({ from: S.guess, to: c });
    S.map.fitPoints([S.guess, c], true);

    $('verdict').hidden = false;
    $('verdict-dist').textContent = fmtKm(km) + ' km';
    var badge = $('verdict-badge');
    badge.textContent = b.label;
    badge.className = 'badge ' + b.cls;
    var place = c.city === c.country ? '<strong>' + c.city + '</strong>'
                                     : '<strong>' + c.city + '</strong>, ' + c.country;
    $('verdict-sub').innerHTML = place + (c.note ? ' · <em>' + c.note + '</em>' : '');
    $('actionbar').className = 'actionbar is-revealed ' + b.cls;
    renderMeta(c, true);
    syncHint();
    $('btn-guess').hidden = true;
    $('btn-next').hidden = false;
    $('btn-next').textContent = S.idx + 1 >= S.deck.length ? 'Voir le résultat' : 'Suivant';
    $('btn-next').focus({ preventScroll: true });
    $('map-hint').hidden = true;
    updateScore();
    $('progress-bar').style.width = ((S.idx + 1) / S.deck.length * 100) + '%';
    postHeight();
  }

  function updateScore() {
    var t = S.results.reduce(function (a, r) { return a + r.km; }, 0);
    $('stat-score').innerHTML = fmtKm(t) + '<i> km</i>';
  }

  /* ---------- fin de partie ---------- */
  function endGame() {
    var total = S.results.reduce(function (a, r) { return a + r.km; }, 0);
    var avg = total / S.results.length;
    var sorted = S.results.slice().sort(function (a, b) { return a.km - b.km; });
    var rank = rankFor(avg);

    $('final-total').textContent = fmtKm(total);
    $('final-avg').textContent = fmtKm(avg) + ' km';
    $('final-best').innerHTML = fmtKm(sorted[0].km) + ' km<small>' + sorted[0].club.name + '</small>';
    $('final-worst').innerHTML = fmtKm(sorted[sorted.length - 1].km) + ' km<small>' +
      sorted[sorted.length - 1].club.name + '</small>';
    $('final-rank').innerHTML = '<b>' + rank[1] + '</b><span>' + rank[2] +
      (S.hintsSpent ? ' · ' + S.hintsSpent + ' indice' + (S.hintsSpent > 1 ? 's' : '') +
                      ' sur ' + HINTS_PER_GAME
                    : ' · aucun indice utilisé') + '</span>';
    $('final-squares').textContent = S.results.map(function (r) { return r.bucket.sq; }).join('');

    $('recap-list').innerHTML = S.results.map(function (r) {
      return '<li class="' + r.bucket.cls + '"><span class="rc-sq">' + r.bucket.sq + '</span>' +
             '<span class="rc-name">' + r.club.name + '</span>' +
             '<span class="rc-city">' + (r.club.flag || '') + ' ' + r.club.city + '</span>' +
             '<span class="rc-km">' + fmtKm(r.km) + ' km</span></li>';
    }).join('');

    buildShare(total, avg);
    show('scr-end');
  }

  function shareURL() {
    var q = new URLSearchParams(location.search);
    if (q.get('share')) return q.get('share');
    return location.origin + location.pathname;
  }

  function buildShare(total, avg) {
    var picked = S.seasons.filter(function (s) { return S.sel[s.id]; });
    var enabled = S.seasons.filter(function (s) {
      return S.clubs.some(function (c) { return c.seasons.indexOf(s.id) >= 0; });
    });
    var eds = picked.length === enabled.length ? 'toutes éditions confondues'
            : picked.map(function (s) { return s.label; }).join(' + ');
    var txt =
      '⚽ GeoConf — le GeoGuessr du foot pour les hipsters\n' +
      'Conference League · ' + eds + ' · ' + S.results.length + ' clubs\n' +
      S.results.map(function (r) { return r.bucket.sq; }).join('') + '\n' +
      'Score : ' + fmtKm(total) + ' km (moy. ' + fmtKm(avg) + ' km/club)\n' +
      (S.hintsSpent ? 'Indices : ' + S.hintsSpent + '/' + HINTS_PER_GAME + '\n'
                    : 'Sans le moindre indice 😤\n') +
      '« ' + rankFor(avg)[1] + ' »\n';
    var url = shareURL();

    $('share-preview').textContent = txt + url;

    var enc = encodeURIComponent(txt + '\n');
    var eu = encodeURIComponent(url);
    $('sh-x').href = 'https://twitter.com/intent/tweet?text=' + enc + '&url=' + eu;
    $('sh-wa').href = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(txt + '\n' + url);
    $('sh-bs').href = 'https://bsky.app/intent/compose?text=' + encodeURIComponent(txt + '\n' + url);
    $('sh-fb').href = 'https://www.facebook.com/sharer/sharer.php?u=' + eu;

    $('sh-copy').onclick = function () {
      var full = txt + url;
      var done = function () {
        $('sh-copy').textContent = 'Copié ✓';
        setTimeout(function () { $('sh-copy').textContent = 'Copier le score'; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(full).then(done, function () { legacyCopy(full); done(); });
      } else { legacyCopy(full); done(); }
    };
    if (navigator.share) {
      $('sh-native').hidden = false;
      $('sh-native').onclick = function () {
        navigator.share({ title: 'GeoConf', text: txt, url: url }).catch(function () {});
      };
    }
  }

  function legacyCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ---------- intégration iframe ---------- */
  var lastH = 0;
  function postHeight() {
    if (window.parent === window) return;
    // On mesure le conteneur, jamais scrollHeight : ce dernier vaut au minimum la
    // hauteur de l'iframe, ce qui ferait grandir l'iframe à chaque aller-retour.
    var app = $('app');
    if (!app) return;
    var h = Math.ceil(app.getBoundingClientRect().height);
    if (!h || Math.abs(h - lastH) < 6) return;
    lastH = h;
    try { window.parent.postMessage({ type: 'geoconf:height', height: h }, '*'); } catch (e) {}
  }
  function watchHeight() {
    if (window.parent === window || !window.ResizeObserver) return;
    var app = $('app');
    if (app) new ResizeObserver(postHeight).observe(app);
  }

  /* ---------- chargement ---------- */
  function json(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → ' + r.status);
      return r.json();
    });
  }

  function normalise(entry, byId, byName) {
    if (typeof entry === 'string') {
      var k = entry.trim().toLowerCase();
      return byId[k] || byName[k] || null;
    }
    if (!entry || entry.lat == null || entry.lon == null) return null;
    var cc = entry.cc || '';
    var meta = COUNTRY_NAMES[cc] || [entry.country || cc, entry.flag || ''];
    return {
      id: entry.id || ('x-' + hash(entry.name + entry.city)),
      name: entry.name, city: entry.city, cc: cc,
      country: entry.country || meta[0], flag: entry.flag || meta[1],
      lat: +entry.lat, lon: +entry.lon, seasons: [], note: entry.note
    };
  }

  function boot() {
    Promise.all([
      json('data/clubs.json'),
      json('data/seasons.json'),
      json('data/europe.json'),
      json('data/season-2026-27.json').catch(function () { return { clubs: [] }; }),
      json('data/logos.json').catch(function () { return {}; })
    ]).then(function (res) {
      S.clubs = res[0]; S.seasons = res[1]; S.logos = res[4] || {};

      // édition 2026/27 renseignée à la main (ou via tools/build-season.mjs)
      var byId = {}, byName = {};
      S.clubs.forEach(function (c) { byId[c.id] = c; byName[c.name.toLowerCase()] = c; });
      (res[3].clubs || []).forEach(function (e) {
        var c = normalise(e, byId, byName);
        if (!c) { console.warn('[GeoConf] 2026/27 : entrée ignorée', e); return; }
        if (!byId[c.id]) { S.clubs.push(c); byId[c.id] = c; byName[c.name.toLowerCase()] = c; }
        if (byId[c.id].seasons.indexOf('2026-27') < 0) byId[c.id].seasons.push('2026-27');
      });

      // pré-sélection éventuelle via ?s=2024-25,2025-26&n=20
      var q = new URLSearchParams(location.search);
      var preset = (q.get('s') || '').split(',').filter(Boolean);
      var available = S.seasons.filter(function (s) {
        return S.clubs.some(function (c) { return c.seasons.indexOf(s.id) >= 0; });
      });
      available.forEach(function (s) {
        S.sel[s.id] = preset.length ? preset.indexOf(s.id) >= 0 : true;
      });
      if (!Object.keys(S.sel).some(function (k) { return S.sel[k]; })) {
        available.forEach(function (s) { S.sel[s.id] = true; });
      }
      var pn = parseInt(q.get('n'), 10);
      if (COUNT_OPTIONS.indexOf(pn) >= 0) S.count = pn;

      S.map = new window.GeoMap($('map'), { onPick: onPick, maxZoom: 90 });
      S.map.setGeo(res[2]);

      renderSeasons(); renderCounts(); renderFacts(); syncHome();
      window.__geoconf = S;   // point d'entrée pour le débogage
      document.body.classList.add('is-ready');
      watchHeight();
      postHeight();
    }).catch(function (e) {
      console.error(e);
      document.body.innerHTML = '<p style="padding:2rem;font:15px system-ui;color:#e6ecff">' +
        'Impossible de charger les données du jeu.<br><small>' + e.message +
        '</small><br><br>Le jeu doit être servi via HTTP (GitHub Pages, ou <code>npx serve</code> en local), ' +
        'pas ouvert directement en <code>file://</code>.</p>';
    });
  }

  /* ---------- branchements ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    $('btn-play').addEventListener('click', startGame);
    $('btn-guess').addEventListener('click', submit);
    $('btn-hint').addEventListener('click', useHint);
    $('btn-next').addEventListener('click', function () { S.idx++; nextRound(); postHeight(); });
    $('btn-again').addEventListener('click', startGame);
    $('btn-home').addEventListener('click', function () { show('scr-home'); syncHome(); });
    $('btn-all-seasons').addEventListener('click', function () {
      var picked = S.seasons.filter(function (s) { return S.sel[s.id]; });
      var on = picked.length <= 1;
      S.seasons.forEach(function (s) {
        var btn = $('season-chips').querySelector('[data-season="' + s.id + '"]');
        if (btn && !btn.disabled) S.sel[s.id] = on;
      });
      syncHome();
    });
    $('zoom-in').addEventListener('click', function () { S.map.zoomBy(1.7); });
    $('zoom-out').addEventListener('click', function () { S.map.zoomBy(1 / 1.7); });
    $('zoom-reset').addEventListener('click', function () {
      if (S.revealed) S.map.fitPoints([S.guess, S.deck[S.idx]], true); else S.map.home(true);
    });
    $('foot-link').href = shareURL();

    var t; window.addEventListener('resize', function () {
      clearTimeout(t); t = setTimeout(function () { if (S.map) S.map.resize(); postHeight(); }, 140);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !$('scr-play').classList.contains('is-active')) return;
      if (!$('btn-next').hidden) { S.idx++; nextRound(); }
      else if (!$('btn-guess').disabled) submit();
    });
    boot();
  });
})();
