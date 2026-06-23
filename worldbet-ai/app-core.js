'use strict';

// ========== CONSTANTS ==========
const FIXTURES_URL = 'https://www.thestatsapi.com/world-cup/data/fixtures.json';
const THESTATSAPI_BASE = 'https://api.thestatsapi.com/api';
const WORLDCUPAPI_BASE = 'https://worldcupapi.com';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const APIFOOTBALL_BASE = 'https://v3.football.api-sports.io';

const COUNTRY_FLAGS = {
  'Algeria':'dz','Argentina':'ar','Australia':'au','Austria':'at','Belgium':'be',
  'Bosnia and Herzegovina':'ba','Brazil':'br','Cabo Verde':'cv','Canada':'ca',
  'Colombia':'co','Congo DR':'cd','Cote d\'Ivoire':'ci','Croatia':'hr','Curacao':'cw',
  'Czechia':'cz','Ecuador':'ec','Egypt':'eg','England':'gb-eng','France':'fr',
  'Germany':'de','Ghana':'gh','Haiti':'ht','IR Iran':'ir','Iraq':'iq','Japan':'jp',
  'Jordan':'jo','Korea Republic':'kr','Mexico':'mx','Morocco':'ma','Netherlands':'nl',
  'New Zealand':'nz','Norway':'no','Panama':'pa','Paraguay':'py','Portugal':'pt',
  'Qatar':'qa','Saudi Arabia':'sa','Scotland':'gb-sct','Senegal':'sn',
  'South Africa':'za','Spain':'es','Sweden':'se','Switzerland':'ch','Tunisia':'tn',
  'Turkiye':'tr','United States':'us','Uruguay':'uy','Uzbekistan':'uz','USA':'us','Iran':'ir'
};

const TEAM_ALIASES = {
  'usa':'United States','united states':'United States','ir iran':'IR Iran','iran':'IR Iran',
  'korea republic':'Korea Republic','south korea':'Korea Republic','cote d\'ivoire':'Cote d\'Ivoire',
  'ivory coast':'Cote d\'Ivoire','congo dr':'Congo DR','dr congo':'Congo DR'
};

const FIFA_RANKINGS_DEMO = {
  'Argentina':1,'France':2,'England':3,'Brazil':4,'Belgium':5,'Portugal':6,
  'Netherlands':7,'Spain':8,'Italy':9,'Croatia':10,'Morocco':11,'Colombia':12,
  'Germany':13,'Uruguay':14,'Mexico':15,'United States':16,'Japan':17,'Senegal':18,
  'Switzerland':19,'Iran':20,'IR Iran':20,'Denmark':21,'Korea Republic':22,
  'Australia':23,'Austria':24,'Turkiye':25,'Canada':26,'Ukraine':27,'Ecuador':28,
  'Norway':29,'Panama':30,'Poland':31,'Wales':32,'Egypt':33,'Scotland':34,
  'Serbia':35,'Paraguay':36,'Czechia':37,'Costa Rica':38,'Algeria':39,'Tunisia':40,
  'Qatar':41,'Saudi Arabia':42,'Ghana':43,'Cameroon':44,'South Africa':45,
  'Iraq':46,'Uzbekistan':47,'Jordan':48,'Haiti':49,'Cote d\'Ivoire':50,
  'Congo DR':51,'Bosnia and Herzegovina':52,'New Zealand':53,'Cabo Verde':54,
  'Curacao':55,'Sweden':56
};

const STAGE_LABELS = {
  'group-stage':'Fase de Grupos','round-of-32':'Dieciseisavos','round-of-16':'Octavos',
  'quarter-finals':'Cuartos','semi-finals':'Semifinales','third-place':'Tercer Puesto','final':'Final'
};

// ========== UTILS ==========
const delay = ms => new Promise(r => setTimeout(r, ms));
const escapeHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const factorialCache = [1];
function factorial(n) {
  if (factorialCache[n] !== undefined) return factorialCache[n];
  factorialCache[n] = n * factorial(n - 1);
  return factorialCache[n];
}
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; };
}
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('es-ES', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
}
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
}
function flagUrl(team) {
  const code = COUNTRY_FLAGS[team] || 'xx';
  return `https://flagcdn.com/w40/${code}.png`;
}
function isPlaceholderTeam(name) {
  return !name || /^(Winner|Loser|Group|TBD|1st|2nd|3rd)\s/i.test(name);
}
function pct(n) { return (n * 100).toFixed(1) + '%'; }
function evFmt(n) { return (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%'; }
function normalizeTeamName(name) {
  if (!name) return '';
  const key = name.trim().toLowerCase();
  return TEAM_ALIASES[key] || name.trim();
}
function teamsMatch(a, b) {
  return normalizeTeamName(a).toLowerCase() === normalizeTeamName(b).toLowerCase();
}
function euro(n) { return '€' + Number(n).toLocaleString('es-ES', { minimumFractionDigits:2, maximumFractionDigits:2 }); }

// ========== DEMO DATA GENERATOR ==========
const DemoDataGenerator = {
  getTeamStrength(team, seed) {
    const rank = FIFA_RANKINGS_DEMO[team] || 40;
    const rand = seededRandom(seed + team.length * 7);
    return { rank, attack: 1.5 - rank * 0.015 + rand() * 0.3, defense: 0.7 + rank * 0.008 + rand() * 0.2 };
  },
  getForm(seed) {
    const rand = seededRandom(seed);
    const results = [];
    for (let i = 0; i < 5; i++) {
      const r = rand();
      results.push(r > 0.55 ? 'W' : r > 0.3 ? 'D' : 'L');
    }
    return results;
  },
  getMatchData(fixture) {
    const seed = fixture.matchNumber * 9973;
    const rand = seededRandom(seed);
    const home = this.getTeamStrength(fixture.homeTeam, seed);
    const away = this.getTeamStrength(fixture.awayTeam, seed + 1);
    const homeForm = this.getForm(seed + 2);
    const awayForm = this.getForm(seed + 3);
    const homeXGFor = Math.max(0.5, home.attack * 0.9 + rand() * 0.5);
    const homeXGAgainst = Math.max(0.4, home.defense * 0.7 + rand() * 0.3);
    const awayXGFor = Math.max(0.5, away.attack * 0.85 + rand() * 0.5);
    const awayXGAgainst = Math.max(0.4, away.defense * 0.75 + rand() * 0.3);
    const h2hW = Math.floor(rand() * 3) + 1;
    const h2hD = Math.floor(rand() * 2);
    const h2hL = 5 - h2hW - h2hD;
    const baseHome = 1.6 + (away.rank - home.rank) * 0.02 + rand() * 0.4;
    const baseDraw = 3.2 + rand() * 0.6;
    const baseAway = 1.8 + (home.rank - away.rank) * 0.02 + rand() * 0.5;
    return {
      homeForm, awayForm, homeXGFor, homeXGAgainst, awayXGFor, awayXGAgainst,
      h2hHomeWins: h2hW, h2hDraws: h2hD, h2hAwayWins: h2hL,
      h2hAvgGoals: 2.2 + rand() * 1.5,
      homeRanking: home.rank, awayRanking: away.rank,
      homeAttack: home.attack, homeDefense: home.defense,
      awayAttack: away.attack, awayDefense: away.defense,
      marketHomeOdds: baseHome, marketDrawOdds: baseDraw, marketAwayOdds: baseAway,
      bookmakers: {
        Bet365: { home: baseHome, draw: baseDraw, away: baseAway },
        Pinnacle: { home: baseHome * 0.98, draw: baseDraw * 1.01, away: baseAway * 0.99 },
        'William Hill': { home: baseHome * 1.02, draw: baseDraw, away: baseAway * 1.03 }
      },
      lineMovement: { opening: baseHome * 1.05, current: baseHome, direction: 'dropping' },
      over25Odds: 1.85 + rand() * 0.3,
      under25Odds: 1.75 + rand() * 0.25,
      dataSources: ['Demo']
    };
  }
};

// ========== API CLIENT ==========
class ApiClient {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
    this.queue = [];
    this.active = 0;
    this.maxConcurrent = 3;
  }
  cacheKey(url, opts) { return url + JSON.stringify(opts?.headers || {}); }
  getCached(key, ttlMs) {
    const e = this.cache.get(key);
    if (e && Date.now() - e.ts < ttlMs) return e.data;
    return null;
  }
  setCache(key, data) { this.cache.set(key, { data, ts: Date.now() }); }
  buildUrl(url, useProxy) {
    if (useProxy && this.config.corsProxy) {
      const proxy = this.config.corsProxy.trim();
      if (proxy.endsWith('=') || proxy.endsWith('?')) {
        return proxy + encodeURIComponent(url);
      }
      const sep = proxy.includes('?') ? '&url=' : '?url=';
      return proxy + sep + encodeURIComponent(url);
    }
    return url;
  }
  async enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processQueue();
    });
  }
  async processQueue() {
    if (this.active >= this.maxConcurrent || !this.queue.length) return;
    const { fn, resolve, reject } = this.queue.shift();
    this.active++;
    try { resolve(await fn()); } catch (e) { reject(e); }
    finally { this.active--; this.processQueue(); }
  }
  async fetchWithRetry(url, options = {}, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      try {
        const res = await fetch(url, { ...options, signal: ctrl.signal });
        clearTimeout(timer);
        if (res.status === 429) { await delay(Math.pow(2, i) * 1000); continue; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        clearTimeout(timer);
        if (i === maxRetries - 1) throw err;
        await delay(1000 * (i + 1));
      }
    }
  }
  async fetchApiOnce(url, options, useProxy) {
    const finalUrl = this.buildUrl(url, useProxy);
    return this.enqueue(() => this.fetchWithRetry(finalUrl, options));
  }
  /**
   * useProxy=true → intenta directo primero (CORS del navegador); proxy solo como fallback.
   * corsproxy.io gratis no funciona en producción (Vercel), pero TheStats/Odds sí permiten CORS directo.
   */
  async fetchApi(url, options = {}, { useProxy = false, ttlMs = 0, demoFallback = null } = {}) {
    const key = this.cacheKey(url, options);
    if (ttlMs > 0) {
      const cached = this.getCached(key, ttlMs);
      if (cached) return cached;
    }
    const attempts = useProxy ? [false, true] : [false];
    for (const viaProxy of attempts) {
      if (viaProxy && !this.config.corsProxy?.trim()) continue;
      try {
        const data = await this.fetchApiOnce(url, options, viaProxy);
        if (ttlMs > 0) this.setCache(key, data);
        return data;
      } catch { /* siguiente intento */ }
    }
    return demoFallback;
  }
  async loadAllFixtures() {
    const data = await this.fetchApi(FIXTURES_URL, {}, { ttlMs: 60 * 60 * 1000 });
    return data?.fixtures || data || [];
  }
  needsProxy() { return !!this.config.corsProxy; }
  async fetchMatchStats(matchId) {
    if (!this.config.thestatsapiKey) return null;
    return this.fetchApi(`${THESTATSAPI_BASE}/football/matches/${matchId}/stats`, {
      headers: { Authorization: `Bearer ${this.config.thestatsapiKey}` }
    }, { useProxy: true, ttlMs: 15 * 60 * 1000 });
  }
  async fetchOddsApiEvents() {
    if (!this.config.oddsApiKey) return null;
    const url = `${ODDS_API_BASE}/sports/soccer_fifa_world_cup/odds?regions=eu&markets=h2h,totals,spreads&apiKey=${this.config.oddsApiKey}`;
    return this.fetchApi(url, {}, { useProxy: true, ttlMs: 5 * 60 * 1000 });
  }
  async fetchTeamForm(teamName) {
    if (!this.config.apifootballKey) return null;
    const headers = { 'x-rapidapi-key': this.config.apifootballKey };
    const search = await this.fetchApi(`${APIFOOTBALL_BASE}/teams?search=${encodeURIComponent(teamName)}`, { headers }, { useProxy: true, ttlMs: 60 * 60 * 1000 });
    const teamId = search?.response?.[0]?.team?.id;
    if (!teamId) return null;
    const fixtures = await this.fetchApi(`${APIFOOTBALL_BASE}/fixtures?team=${teamId}&last=5`, { headers }, { useProxy: true, ttlMs: 15 * 60 * 1000 });
    return { fixtures, teamId };
  }
  async fetchHeadToHead(team1, team2) {
    if (!this.config.apifootballKey) return null;
    const headers = { 'x-rapidapi-key': this.config.apifootballKey };
    const t1 = await this.fetchApi(`${APIFOOTBALL_BASE}/teams?search=${encodeURIComponent(team1)}`, { headers }, { useProxy: true });
    const t2 = await this.fetchApi(`${APIFOOTBALL_BASE}/teams?search=${encodeURIComponent(team2)}`, { headers }, { useProxy: true });
    const id1 = t1?.response?.[0]?.team?.id;
    const id2 = t2?.response?.[0]?.team?.id;
    if (!id1 || !id2) return null;
    return this.fetchApi(`${APIFOOTBALL_BASE}/fixtures/headtohead?h2h=${id1}-${id2}`, { headers }, { useProxy: true, ttlMs: 15 * 60 * 1000 });
  }
  parseOddsApiForMatch(events, homeTeam, awayTeam) {
    if (!Array.isArray(events)) return null;
    const match = events.find(e => teamsMatch(e.home_team, homeTeam) && teamsMatch(e.away_team, awayTeam));
    if (!match) return null;
    const result = { bookmakers: {}, marketHomeOdds: null, marketDrawOdds: null, marketAwayOdds: null, over25Odds: null, under25Odds: null };
    for (const bm of match.bookmakers || []) {
      const h2h = bm.markets?.find(m => m.key === 'h2h');
      if (h2h) {
        const home = h2h.outcomes?.find(o => teamsMatch(o.name, homeTeam));
        const away = h2h.outcomes?.find(o => teamsMatch(o.name, awayTeam));
        const draw = h2h.outcomes?.find(o => /draw|empate/i.test(o.name));
        result.bookmakers[bm.title] = { home: home?.price, draw: draw?.price, away: away?.price };
        if (!result.marketHomeOdds) {
          result.marketHomeOdds = home?.price;
          result.marketDrawOdds = draw?.price;
          result.marketAwayOdds = away?.price;
        }
      }
      const totals = bm.markets?.find(m => m.key === 'totals');
      if (totals) {
        const over = totals.outcomes?.find(o => o.name === 'Over' && o.point === 2.5);
        const under = totals.outcomes?.find(o => o.name === 'Under' && o.point === 2.5);
        if (over) result.over25Odds = over.price;
        if (under) result.under25Odds = under.price;
      }
    }
    return result.marketHomeOdds ? result : null;
  }
  async testTheStatsApi() {
    if (!this.config.thestatsapiKey) return { ok: false, msg: 'Sin API key' };
    const d = await this.fetchApi(`${THESTATSAPI_BASE}/health`, {
      headers: { Authorization: `Bearer ${this.config.thestatsapiKey}` }
    }, { useProxy: true, ttlMs: 0 });
    const ok = d?.status === 'healthy';
    return { ok, msg: ok ? 'healthy' : (d?.status || 'Sin respuesta') };
  }
  async testWorldCupApi() {
    if (!this.config.worldcupApiKey) return { ok: false, msg: 'Sin API key' };
    return this.fetchApi(`${WORLDCUPAPI_BASE}/fixtures?key=${this.config.worldcupApiKey}`, {}, { useProxy: true })
      .then(d => ({ ok: !!d, msg: 'OK' })).catch(() => ({ ok: false, msg: 'Error CORS/API' }));
  }
  async testOddsApi() {
    if (!this.config.oddsApiKey) return { ok: false, msg: 'Sin API key' };
    const d = await this.fetchApi(`${ODDS_API_BASE}/sports/?apiKey=${this.config.oddsApiKey}`, {}, { useProxy: true, ttlMs: 0 });
    return { ok: Array.isArray(d), msg: Array.isArray(d) ? 'OK' : 'Error CORS/API' };
  }
  async testApiFootball() {
    if (!this.config.apifootballKey) return { ok: false, msg: 'Sin API key' };
    return this.fetchApi(`${APIFOOTBALL_BASE}/status`, {
      headers: { 'x-rapidapi-key': this.config.apifootballKey }
    }, { useProxy: true }).then(d => ({ ok: !!d, msg: 'OK' })).catch(() => ({ ok: false, msg: 'Error CORS/API' }));
  }
}

// ========== PREDICTION ENGINE ==========
const PredictionEngine = {
  /**
   * P(X=k) = e^(-λ) * λ^k / k!
   * Distribución de Poisson para goles esperados.
   */
  poissonProbability(lambda, k) {
    return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
  },
  /**
   * Modelo Poisson bivariado: calcula probabilidades 1X2
   * a partir de fuerzas de ataque/defensa relativas.
   */
  predictMatchScore(homeAttack, homeDefense, awayAttack, awayDefense, leagueAvg = 1.35) {
    const homeLambda = homeAttack * awayDefense * leagueAvg;
    const awayLambda = awayAttack * homeDefense * leagueAvg;
    const maxGoals = 8;
    let homeWin = 0, draw = 0, awayWin = 0;
    const scoreProbabilities = [];
    for (let i = 0; i <= maxGoals; i++) {
      for (let j = 0; j <= maxGoals; j++) {
        const prob = this.poissonProbability(homeLambda, i) * this.poissonProbability(awayLambda, j);
        scoreProbabilities.push({ home: i, away: j, probability: prob });
        if (i > j) homeWin += prob;
        else if (i === j) draw += prob;
        else awayWin += prob;
      }
    }
    const sorted = [...scoreProbabilities].sort((a, b) => b.probability - a.probability);
    return {
      homeWin, draw, awayWin,
      expectedHomeGoals: homeLambda, expectedAwayGoals: awayLambda,
      mostLikelyScore: sorted[0],
      top5Scores: sorted.slice(0, 5),
      scoreProbabilities: sorted
    };
  },
  /**
   * Ajuste 60% Poisson base + 40% xG como corrector.
   */
  adjustWithXG(basePrediction, homeXGFor, homeXGAgainst, awayXGFor, awayXGAgainst) {
    const xgHomeGoals = homeXGFor * 0.6 + (1 / Math.max(awayXGAgainst, 0.3)) * 0.4;
    const xgAwayGoals = awayXGFor * 0.6 + (1 / Math.max(homeXGAgainst, 0.3)) * 0.4;
    return {
      adjustedHomeLambda: basePrediction.expectedHomeGoals * 0.6 + xgHomeGoals * 0.4,
      adjustedAwayLambda: basePrediction.expectedAwayGoals * 0.6 + xgAwayGoals * 0.4
    };
  },
  recalcFromLambdas(homeLambda, awayLambda, leagueAvg = 1.35) {
    const ha = homeLambda / leagueAvg, hd = 1, aa = awayLambda / leagueAvg, ad = 1;
    return this.predictMatchScore(ha, hd, aa, ad, leagueAvg);
  },
  /**
   * EV = (prob_modelo * cuota) - 1
   * Edge = prob_modelo - prob_implícita_mercado
   */
  detectValueBet(modelProbability, marketOdds, minEdge = 0.05) {
    const impliedProb = 1 / marketOdds;
    const edge = modelProbability - impliedProb;
    const expectedValue = modelProbability * marketOdds - 1;
    return {
      edge, expectedValue,
      isValueBet: edge > minEdge,
      confidence: edge > 0.10 ? 'HIGH' : edge > minEdge ? 'MEDIUM' : 'LOW',
      recommendation: expectedValue > 0.08 ? '✅ APOSTAR' : expectedValue > 0 ? '⚠️ CONSIDERAR' : '❌ EVITAR'
    };
  },
  /**
   * Kelly: f* = (bp - q) / b, con fracción para reducir riesgo.
   */
  kellyCriterion(modelProbability, decimalOdds, bankroll, fractionKelly = 0.25) {
    const b = decimalOdds - 1, p = modelProbability, q = 1 - p;
    const fullKelly = b > 0 ? (b * p - q) / b : 0;
    const fractionalKelly = Math.max(0, fullKelly * fractionKelly);
    return {
      fullKelly: Math.max(0, fullKelly),
      recommendedBet: fractionalKelly,
      stakeSuggestion: fractionalKelly * bankroll,
      riskLevel: fractionalKelly > 0.05 ? 'ALTO' : fractionalKelly > 0.02 ? 'MEDIO' : 'BAJO'
    };
  },
  over25Probability(homeLambda, awayLambda) {
    return 1 - this.totalGoalsUnderProbability(homeLambda, awayLambda, 2.5);
  },
  totalGoalsUnderProbability(homeLambda, awayLambda, line) {
    const max = Math.floor(line);
    let under = 0;
    for (let h = 0; h <= 8; h++) {
      for (let a = 0; a <= 8; a++) {
        if (h + a <= max) {
          under += this.poissonProbability(homeLambda, h) * this.poissonProbability(awayLambda, a);
        }
      }
    }
    return under;
  },
  bttsProbability(homeLambda, awayLambda) {
    let yes = 0;
    for (let h = 1; h <= 8; h++) {
      for (let a = 1; a <= 8; a++) {
        yes += this.poissonProbability(homeLambda, h) * this.poissonProbability(awayLambda, a);
      }
    }
    return { yes, no: 1 - yes };
  },
  firstGoalProbability(homeLambda, awayLambda) {
    const noGoals = this.poissonProbability(homeLambda, 0) * this.poissonProbability(awayLambda, 0);
    const withGoals = 1 - noGoals;
    const total = homeLambda + awayLambda;
    const homeFirst = total > 0 ? (homeLambda / total) * withGoals : 0;
    const awayFirst = total > 0 ? (awayLambda / total) * withGoals : 0;
    return { homeFirst, awayFirst, noGoals };
  },
  fairOdds(prob, margin = 0.92) {
    return prob > 0.001 ? Math.min(99, margin / prob) : 99;
  },
  pickConfidence(prob) {
    if (prob >= 0.50) return 'ALTA';
    if (prob >= 0.28) return 'MEDIA';
    return 'CULEBRA';
  },
  /**
   * Genera candidatos de apuesta desde el análisis Poisson + xG + datos API.
   */
  buildAnalysisPicks(fixture, result) {
    const p = result.prediction;
    const d = result.data;
    const hL = result.adjusted.adjustedHomeLambda;
    const aL = result.adjusted.adjustedAwayLambda;
    const picks = [];
    const add = (type, label, prob, odds) => {
      if (prob < 0.05) return;
      picks.push({
        type, label, prob,
        odds: odds || this.fairOdds(prob),
        confidence: this.pickConfidence(prob)
      });
    };

    add('ganador', `${fixture.homeTeam} gana`, p.homeWin, d.marketHomeOdds);
    add('ganador', 'Empate', p.draw, d.marketDrawOdds);
    add('ganador', `${fixture.awayTeam} gana`, p.awayWin, d.marketAwayOdds);

    const homeOrDraw = p.homeWin + p.draw;
    const awayOrDraw = p.awayWin + p.draw;
    add('doble_chance', `${fixture.homeTeam} o Empate`, homeOrDraw, this.fairOdds(homeOrDraw));
    add('doble_chance', `${fixture.awayTeam} o Empate`, awayOrDraw, this.fairOdds(awayOrDraw));

    p.top5Scores.slice(0, 3).forEach(s => {
      add('marcador', `Marcador exacto ${s.home}-${s.away}`, s.probability, this.fairOdds(s.probability));
    });

    [1.5, 2.5, 3.5].forEach(line => {
      const under = this.totalGoalsUnderProbability(hL, aL, line);
      const over = 1 - under;
      const overOdds = line === 2.5 ? (d.over25Odds || this.fairOdds(over)) : this.fairOdds(over);
      const underOdds = line === 2.5 ? (d.under25Odds || this.fairOdds(under)) : this.fairOdds(under);
      add('goles', `Over ${line} goles`, over, overOdds);
      add('goles', `Under ${line} goles`, under, underOdds);
    });

    const btts = this.bttsProbability(hL, aL);
    add('btts', 'Ambos marcan (Sí)', btts.yes, this.fairOdds(btts.yes));
    add('btts', 'Ambos marcan (No)', btts.no, this.fairOdds(btts.no));

    const fg = this.firstGoalProbability(hL, aL);
    add('primer_gol', `Primer gol: ${fixture.homeTeam}`, fg.homeFirst, this.fairOdds(fg.homeFirst));
    add('primer_gol', `Primer gol: ${fixture.awayTeam}`, fg.awayFirst, this.fairOdds(fg.awayFirst));

    return picks;
  },
  /**
   * Elige la apuesta principal de forma coherente con el análisis.
   * Por defecto = ganador del modelo; solo cambia si otro mercado es mucho más claro.
   */
  pickPrimaryBet(fixture, result, picks) {
    const p = result.prediction;
    const d = result.data;
    const winners = [
      { label: `${fixture.homeTeam} gana`, prob: p.homeWin, odds: d.marketHomeOdds, type: 'ganador' },
      { label: 'Empate', prob: p.draw, odds: d.marketDrawOdds, type: 'ganador' },
      { label: `${fixture.awayTeam} gana`, prob: p.awayWin, odds: d.marketAwayOdds, type: 'ganador' }
    ].sort((a, b) => b.prob - a.prob);
    const modelWinner = winners[0];
    const enrich = (pick, reason) => ({
      ...pick,
      primaryReason: reason,
      confidence: pick.confidence || this.pickConfidence(pick.prob)
    });
    const goalsPick = picks.find(x => x.label === (result.over25Prob >= result.under25Prob ? 'Over 2.5 goles' : 'Under 2.5 goles'));
    const bttsYes = picks.find(x => x.label === 'Ambos marcan (Sí)');
    const bttsNo = picks.find(x => x.label === 'Ambos marcan (No)');
    const bttsPick = (bttsYes?.prob || 0) >= (bttsNo?.prob || 0) ? bttsYes : bttsNo;

    if (goalsPick?.prob >= 0.65 && modelWinner.prob < 0.36) {
      return enrich(goalsPick, 'Línea de goles muy clara en el análisis');
    }
    if (bttsPick?.prob >= 0.65 && modelWinner.prob < 0.34) {
      return enrich(bttsPick, 'Ambos equipos marcan con alta probabilidad');
    }

    const winnerPick = picks.find(x => x.label === modelWinner.label) || {
      ...modelWinner, type: 'ganador', confidence: this.pickConfidence(modelWinner.prob)
    };
    return enrich(winnerPick, 'Ganador más probable según Poisson + xG + APIs');
  },
  goalsAnalysis(result) {
    const p = result.prediction;
    const ms = p.mostLikelyScore;
    const expected = p.expectedHomeGoals + p.expectedAwayGoals;
    const msTotal = ms.home + ms.away;
    const over = result.over25Prob;
    const under = result.under25Prob;
    const pickOver = over >= under;
    const label = pickOver ? 'Over 2.5 goles' : 'Under 2.5 goles';
    const prob = pickOver ? over : under;
    let note = '';
    if (msTotal <= 2 && pickOver && over < 0.62) {
      note = `Promedio ${expected.toFixed(1)} goles esperados. El ${ms.home}-${ms.away} es el marcador más probable, pero sumando todos los resultados posibles el modelo inclina levemente a +2.5 (${pct(over)}).`;
    } else if (msTotal >= 3 && !pickOver) {
      note = `El ${ms.home}-${ms.away} sugiere muchos goles, pero la distribución completa favorece Under 2.5 (${pct(under)}).`;
    } else if (pickOver) {
      note = `${expected.toFixed(1)} goles esperados en total → ${label} (${pct(prob)}).`;
    } else {
      note = `${expected.toFixed(1)} goles esperados en total → ${label} (${pct(prob)}).`;
    }
    return { label, prob, expected: expected.toFixed(1), note };
  },
  buildFeatures(fixture, data, leagueAvg) {
    return {
      homeForm: data.homeForm, awayForm: data.awayForm,
      homeXGFor: data.homeXGFor, homeXGAgainst: data.homeXGAgainst,
      awayXGFor: data.awayXGFor, awayXGAgainst: data.awayXGAgainst,
      h2hHomeWins: data.h2hHomeWins, h2hDraws: data.h2hDraws, h2hAwayWins: data.h2hAwayWins,
      h2hAvgGoals: data.h2hAvgGoals,
      homeRanking: data.homeRanking, awayRanking: data.awayRanking,
      rankingDiff: data.awayRanking - data.homeRanking,
      matchStage: fixture.stage, homeAdvantage: 0.0,
      marketHomeOdds: data.marketHomeOdds, marketDrawOdds: data.marketDrawOdds, marketAwayOdds: data.marketAwayOdds
    };
  },
  runFullPrediction(fixture, data, config) {
    const base = this.predictMatchScore(
      data.homeAttack, data.homeDefense, data.awayAttack, data.awayDefense, config.leagueAvgGoals
    );
    const adj = this.adjustWithXG(base, data.homeXGFor, data.homeXGAgainst, data.awayXGFor, data.awayXGAgainst);
    const finalPred = this.recalcFromLambdas(adj.adjustedHomeLambda, adj.adjustedAwayLambda, config.leagueAvgGoals);
    const features = this.buildFeatures(fixture, data, config.leagueAvgGoals);
    const over25Prob = this.over25Probability(adj.adjustedHomeLambda, adj.adjustedAwayLambda);
    const under25Prob = 1 - over25Prob;
    const markets = [
      { market: `${fixture.homeTeam} gana`, prob: finalPred.homeWin, odds: data.marketHomeOdds },
      { market: 'Empate', prob: finalPred.draw, odds: data.marketDrawOdds },
      { market: `${fixture.awayTeam} gana`, prob: finalPred.awayWin, odds: data.marketAwayOdds },
      { market: 'Over 2.5 goles', prob: over25Prob, odds: data.over25Odds || 1.9 },
      { market: 'Under 2.5 goles', prob: under25Prob, odds: data.under25Odds || 1.9 }
    ];
    const result = { features, base, adjusted: adj, prediction: finalPred, over25Prob, under25Prob, data };
    const analysisPicks = this.buildAnalysisPicks(fixture, result);
    result.analysisPicks = analysisPicks.map(pick => ({
      ...pick,
      kelly: this.kellyCriterion(pick.prob, pick.odds, config.bankroll, config.kellyFraction)
    })).sort((a, b) => b.prob - a.prob);
    result.valueBets = result.analysisPicks.slice(0, 6);
    result.recommendation = this.buildRecommendation(fixture, result);
    return result;
  },
  /**
   * Apuesta recomendada según análisis del modelo (no value betting vs mercado).
   */
  buildRecommendation(fixture, result) {
    const p = result.prediction;
    const ms = p.mostLikelyScore;
    const picks = result.analysisPicks || [];
    const outcomes = [
      { label: `${fixture.homeTeam} gana`, prob: p.homeWin },
      { label: 'Empate', prob: p.draw },
      { label: `${fixture.awayTeam} gana`, prob: p.awayWin }
    ].sort((a, b) => b.prob - a.prob);
    const modelWinner = outcomes[0];
    const goals = this.goalsAnalysis(result);
    const fg = this.firstGoalProbability(result.adjusted.adjustedHomeLambda, result.adjusted.adjustedAwayLambda);
    const firstGoalPick = fg.homeFirst >= fg.awayFirst
      ? { label: `Primer gol: ${fixture.homeTeam}`, prob: fg.homeFirst }
      : { label: `Primer gol: ${fixture.awayTeam}`, prob: fg.awayFirst };
    const primary = this.pickPrimaryBet(fixture, result, picks);
    const primaryKelly = picks.find(x => x.label === primary.label)?.kelly
      || this.kellyCriterion(primary.prob, primary.odds, result.data.bankroll || 10000, 0.25);
    const altPicks = picks
      .filter(pick => pick.label !== primary.label)
      .slice(0, 6);
    return {
      modelWinner: modelWinner.label,
      modelWinnerProb: modelWinner.prob,
      likelyScore: `${ms.home}-${ms.away}`,
      likelyScoreProb: ms.probability,
      expectedTotalGoals: goals.expected,
      goalsPick: goals.label,
      goalsPickProb: goals.prob,
      goalsNote: goals.note,
      firstGoalPick: firstGoalPick.label,
      firstGoalProb: firstGoalPick.prob,
      primaryBet: primary.label,
      primaryAction: '🎯 Apuesta recomendada',
      primaryReason: primary.primaryReason,
      primaryType: primary.type,
      primaryProb: primary.prob,
      primaryOdds: primary.odds,
      primaryConfidence: primary.confidence,
      primaryKelly,
      hasValueBet: false,
      picks: altPicks,
      dataSources: result.data.dataSources || ['Demo'],
      summary: `${primary.label} (${pct(primary.prob)}) @ ${primary.odds?.toFixed(2)} · Marcador ${ms.home}-${ms.away} · ${goals.label} · ${firstGoalPick.label}`
    };
  }
};

// ========== BET SETTLEMENT ==========
const BetSettlement = {
  settleBet(marketType, marketLabel, homeTeam, awayTeam, homeScore, awayScore) {
    const total = homeScore + awayScore;
    const homeWins = homeScore > awayScore;
    const awayWins = awayScore > homeScore;
    const isDraw = homeScore === awayScore;
    const bothScored = homeScore > 0 && awayScore > 0;
    const label = String(marketLabel || '').trim();

    switch (marketType) {
      case 'ganador': {
        if (/empate/i.test(label)) return isDraw ? 'won' : 'lost';
        if (label.includes(homeTeam)) return homeWins ? 'won' : 'lost';
        if (label.includes(awayTeam)) return awayWins ? 'won' : 'lost';
        return 'void';
      }
      case 'doble_chance': {
        if (label.includes(homeTeam) && /empate/i.test(label)) return (homeWins || isDraw) ? 'won' : 'lost';
        if (label.includes(awayTeam) && /empate/i.test(label)) return (awayWins || isDraw) ? 'won' : 'lost';
        return 'void';
      }
      case 'goles': {
        const overM = label.match(/Over\s+([\d.]+)/i);
        const underM = label.match(/Under\s+([\d.]+)/i);
        if (overM) return total > parseFloat(overM[1]) ? 'won' : 'lost';
        if (underM) return total < parseFloat(underM[1]) ? 'won' : 'lost';
        return 'void';
      }
      case 'btts': {
        if (/sí|si/i.test(label)) return bothScored ? 'won' : 'lost';
        if (/no/i.test(label)) return !bothScored ? 'won' : 'lost';
        return 'void';
      }
      case 'marcador': {
        const sm = label.match(/(\d+)\s*-\s*(\d+)/);
        if (sm) return (homeScore === parseInt(sm[1], 10) && awayScore === parseInt(sm[2], 10)) ? 'won' : 'lost';
        return 'void';
      }
      case 'primer_gol': {
        if (homeScore === 0 && awayScore === 0) return 'void';
        if (label.includes(homeTeam)) return homeScore > 0 && awayScore === 0 ? 'won' : (homeScore > awayScore ? 'won' : 'lost');
        if (label.includes(awayTeam)) return awayScore > 0 && homeScore === 0 ? 'won' : (awayScore > homeScore ? 'won' : 'lost');
        return 'void';
      }
      default:
        return 'void';
    }
  },
  calcPayout(stake, odds, result) {
    if (result === 'won') return stake * (odds - 1);
    return 0;
  }
};

// ========== CHART MANAGER ==========
const ChartManager = {
  instances: {},
  destroyAll() {
    Object.values(this.instances).forEach(c => c?.destroy?.());
    this.instances = {};
  },
  destroy(id) {
    if (this.instances[id]) { this.instances[id].destroy(); delete this.instances[id]; }
  },
  chartColors() {
    const dark = true;
    return { text: dark ? '#8892aa' : '#4a5570', grid: dark ? '#2a3148' : '#dde3ed' };
  },
  createProbDoughnut(canvasId, probs, labels) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const colors = this.chartColors();
    this.instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: probs.map(p => p * 100), backgroundColor: ['#00c853','#ff9800','#2196f3'], borderWidth: 0 }]
      },
      options: {
        plugins: { legend: { labels: { color: colors.text } } },
        cutout: '60%'
      }
    });
  },
  createGoalsBar(canvasId, homeLambda, awayLambda) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const colors = this.chartColors();
    const labels = ['0','1','2','3','4','5+'];
    const homeData = [], awayData = [];
    for (let g = 0; g < 5; g++) {
      homeData.push(PredictionEngine.poissonProbability(homeLambda, g) * 100);
      awayData.push(PredictionEngine.poissonProbability(awayLambda, g) * 100);
    }
    homeData[4] += (1 - homeData.reduce((a,b)=>a+b,0)/100) * 100;
    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Local', data: homeData, backgroundColor: '#00c853' },
          { label: 'Visitante', data: awayData, backgroundColor: '#2196f3' }
        ]
      },
      options: {
        scales: {
          x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.text }, grid: { color: colors.grid } }
        },
        plugins: { legend: { labels: { color: colors.text } } }
      }
    });
  },
  createXGBar(canvasId, data, homeTeam, awayTeam) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const colors = this.chartColors();
    this.instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['xG a favor', 'xG en contra'],
        datasets: [
          { label: homeTeam, data: [data.homeXGFor, data.homeXGAgainst], backgroundColor: '#00c853' },
          { label: awayTeam, data: [data.awayXGFor, data.awayXGAgainst], backgroundColor: '#2196f3' }
        ]
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.text }, grid: { color: colors.grid } }
        },
        plugins: { legend: { labels: { color: colors.text } } }
      }
    });
  },
  createPerformanceLine(canvasId, history) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const colors = this.chartColors();
    this.instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: history.map(h => h.week),
        datasets: [{
          label: '% Acierto', data: history.map(h => h.accuracy),
          borderColor: '#00c853', backgroundColor: 'rgba(0,200,83,0.1)', fill: true, tension: 0.3
        }]
      },
      options: {
        scales: {
          x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
          y: { min: 40, max: 80, ticks: { color: colors.text }, grid: { color: colors.grid } }
        },
        plugins: { legend: { labels: { color: colors.text } } }
      }
    });
  },
  renderHeatmap(containerId, scoreProbabilities) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const max = 5;
    let html = '<div style="display:grid;grid-template-columns:24px repeat(5,1fr);gap:2px;font-size:9px">';
    html += '<div></div>';
    for (let j = 0; j < max; j++) html += `<div style="text-align:center;color:var(--color-text-muted)">${j}</div>`;
    let maxProb = 0;
    const probs = {};
    scoreProbabilities.forEach(s => {
      if (s.home < max && s.away < max) {
        probs[`${s.home}-${s.away}`] = s.probability;
        if (s.probability > maxProb) maxProb = s.probability;
      }
    });
    for (let i = 0; i < max; i++) {
      html += `<div style="color:var(--color-text-muted);display:flex;align-items:center">${i}</div>`;
      for (let j = 0; j < max; j++) {
        const p = probs[`${i}-${j}`] || 0;
        const intensity = maxProb > 0 ? p / maxProb : 0;
        const bg = `rgba(0,200,83,${0.15 + intensity * 0.85})`;
        html += `<div class="heatmap-cell" style="background:${bg}" title="${i}-${j}: ${pct(p)}">${p > 0.02 ? pct(p) : ''}</div>`;
      }
    }
    html += '</div>';
    el.innerHTML = html;
  }
};
