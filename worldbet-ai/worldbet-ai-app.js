// ========== CONSTANTS ==========
const FIXTURES_URL = 'https://www.thestatsapi.com/world-cup/data/fixtures.json';
const THESTATSAPI_BASE = 'https://api.thestatsapi.com/api';
const WORLDCUPAPI_BASE = 'https://worldcupapi.com';
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const APIFOOTBALL_BASE = 'https://v3.football.api-sports.io';
const WC_COMPETITION = 'comp_6107';
const WC_SEASON = 'sn_118868';

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

const FALLBACK_FIXTURES = [
  { id:'demo-1', matchNumber:1, homeTeam:'Mexico', awayTeam:'South Africa', date:'2026-06-11T19:00:00Z', stage:'group-stage', group:'A', stadium:'Estadio Azteca', city:'Ciudad de México', status:'scheduled' },
  { id:'demo-2', matchNumber:2, homeTeam:'Brazil', awayTeam:'Morocco', date:'2026-06-12T18:00:00Z', stage:'group-stage', group:'B', stadium:'MetLife Stadium', city:'New York', status:'scheduled' },
  { id:'demo-3', matchNumber:3, homeTeam:'Argentina', awayTeam:'Colombia', date:'2026-06-15T21:00:00Z', stage:'group-stage', group:'C', stadium:'Hard Rock Stadium', city:'Miami', status:'scheduled' },
  { id:'demo-4', matchNumber:4, homeTeam:'France', awayTeam:'Germany', date:'2026-06-16T20:00:00Z', stage:'group-stage', group:'D', stadium:'SoFi Stadium', city:'Los Angeles', status:'scheduled' },
  { id:'demo-5', matchNumber:5, homeTeam:'England', awayTeam:'Spain', date:'2026-06-18T19:00:00Z', stage:'group-stage', group:'E', stadium:'AT&T Stadium', city:'Dallas', status:'scheduled' },
  { id:'demo-6', matchNumber:6, homeTeam:'Portugal', awayTeam:'Netherlands', date:'2026-06-20T18:00:00Z', stage:'group-stage', group:'F', stadium:'Lincoln Financial Field', city:'Philadelphia', status:'scheduled' },
  { id:'demo-7', matchNumber:7, homeTeam:'United States', awayTeam:'Canada', date:'2026-06-22T22:00:00Z', stage:'group-stage', group:'G', stadium:'BC Place', city:'Vancouver', status:'scheduled' },
  { id:'demo-8', matchNumber:8, homeTeam:'Japan', awayTeam:'Korea Republic', date:'2026-06-24T17:00:00Z', stage:'group-stage', group:'H', stadium:'Mercedes-Benz Stadium', city:'Atlanta', status:'scheduled' }
];

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
function formBar(form) {
  return form.map(r => `<span class="form-badge ${r}">${r}</span>`).join('');
}
function euro(n) { return '€' + Number(n).toLocaleString('es-ES', { minimumFractionDigits:2, maximumFractionDigits:2 }); }

// ========== DEMO DATA GENERATOR ==========
const DemoDataGenerator = {
  getTeamStrength(team, seed) {
    const rank = FIFA_RANKINGS_DEMO[team] || 40;
    const rand = seededRandom(seed + (team?.length || 0) * 7);
    return { rank, attack: 1.5 - rank * 0.015 + rand() * 0.3, defense: 0.7 + rank * 0.008 + rand() * 0.2 };
  },
  getForm(seed) {
    const rand = seededRandom(seed);
    return Array.from({ length:5 }, () => { const r = rand(); return r > 0.55 ? 'W' : r > 0.3 ? 'D' : 'L'; });
  },
  getMatchData(fixture) {
    const seed = (fixture.matchNumber || 1) * 9973;
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
    const direction = rand() > 0.5 ? 'dropping' : 'rising';
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
      lineMovement: { opening: baseHome * 1.05, current: baseHome, direction },
      over25Odds: 1.85 + rand() * 0.3,
      isDemo: true
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
  needsProxy() { return !!this.config.corsProxy; }
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
  async fetchApi(url, options = {}, { useProxy = false, ttlMs = 0, demoFallback = null } = {}) {
    const finalUrl = this.buildUrl(url, useProxy);
    const key = this.cacheKey(finalUrl, options);
    if (ttlMs > 0) {
      const cached = this.getCached(key, ttlMs);
      if (cached) return cached;
    }
    try {
      const data = await this.enqueue(() => this.fetchWithRetry(finalUrl, options));
      if (ttlMs > 0) this.setCache(key, data);
      return data;
    } catch {
      return demoFallback;
    }
  }
  async loadAllFixtures() {
    const data = await this.fetchApi(FIXTURES_URL, {}, { ttlMs: 60 * 60 * 1000 });
    return data?.fixtures || data || null;
  }
  async fetchMatchStats(matchId) {
    if (!this.config.thestatsapiKey) return null;
    return this.fetchApi(`${THESTATSAPI_BASE}/football/matches/${matchId}/stats`, {
      headers: { Authorization: `Bearer ${this.config.thestatsapiKey}` }
    }, { useProxy: true, ttlMs: 15 * 60 * 1000 });
  }
  async fetchTheStatsOdds(matchId) {
    if (!this.config.thestatsapiKey) return null;
    return this.fetchApi(`${THESTATSAPI_BASE}/football/matches/${matchId}/odds`, {
      headers: { Authorization: `Bearer ${this.config.thestatsapiKey}` }
    }, { useProxy: true, ttlMs: 5 * 60 * 1000 });
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
    const stats = await this.fetchApi(`${APIFOOTBALL_BASE}/teams/statistics?league=1&season=2026&team=${teamId}`, { headers }, { useProxy: true, ttlMs: 15 * 60 * 1000 });
    const fixtures = await this.fetchApi(`${APIFOOTBALL_BASE}/fixtures?team=${teamId}&last=5`, { headers }, { useProxy: true, ttlMs: 15 * 60 * 1000 });
    return { stats, fixtures, teamId };
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
  async fetchWorldCupFixtures(date) {
    if (!this.config.worldcupApiKey) return null;
    let url = `${WORLDCUPAPI_BASE}/fixtures?key=${this.config.worldcupApiKey}`;
    if (date) url += `&date=${date}`;
    return this.fetchApi(url, {}, { useProxy: true, ttlMs: 15 * 60 * 1000 });
  }
  parseOddsApiForMatch(events, homeTeam, awayTeam) {
    if (!Array.isArray(events)) return null;
    const match = events.find(e => teamsMatch(e.home_team, homeTeam) && teamsMatch(e.away_team, awayTeam));
    if (!match) return null;
    const result = { bookmakers: {}, marketHomeOdds: null, marketDrawOdds: null, marketAwayOdds: null, over25Odds: null };
    for (const bm of match.bookmakers || []) {
      const h2h = bm.markets?.find(m => m.key === 'h2h');
      if (h2h) {
        const home = h2h.outcomes?.find(o => teamsMatch(o.name, homeTeam));
        const away = h2h.outcomes?.find(o => teamsMatch(o.name, awayTeam));
        const draw = h2h.outcomes?.find(o => /draw|empate/i.test(o.name));
        result.bookmakers[bm.title] = { home: home?.price, draw: draw?.price, away: away?.price };
        if (bm.title === 'Bet365' || !result.marketHomeOdds) {
          result.marketHomeOdds = home?.price;
          result.marketDrawOdds = draw?.price;
          result.marketAwayOdds = away?.price;
        }
      }
      const totals = bm.markets?.find(m => m.key === 'totals');
      const over = totals?.outcomes?.find(o => o.name === 'Over' && o.point === 2.5);
      if (over) result.over25Odds = over.price;
    }
    return result.marketHomeOdds ? result : null;
  }
  async testTheStatsApi() {
    if (!this.config.thestatsapiKey) return { ok: false, msg: 'Sin API key' };
    const d = await this.fetchApi(`${THESTATSAPI_BASE}/health`, {
      headers: { Authorization: `Bearer ${this.config.thestatsapiKey}` }
    }, { useProxy: this.needsProxy(), ttlMs: 0 });
    return { ok: !!d?.status, msg: d?.status || 'Error' };
  }
  async testWorldCupApi() {
    if (!this.config.worldcupApiKey) return { ok: false, msg: 'Sin API key' };
    const d = await this.fetchApi(`${WORLDCUPAPI_BASE}/fixtures?key=${this.config.worldcupApiKey}`, {}, { useProxy: true });
    return { ok: !!d, msg: d ? 'OK' : 'Error CORS/API' };
  }
  async testOddsApi() {
    if (!this.config.oddsApiKey) return { ok: false, msg: 'Sin API key' };
    const d = await this.fetchApi(`${ODDS_API_BASE}/sports/?apiKey=${this.config.oddsApiKey}`, {}, { useProxy: true });
    return { ok: Array.isArray(d), msg: Array.isArray(d) ? 'OK' : 'Error CORS/API' };
  }
  async testApiFootball() {
    if (!this.config.apifootballKey) return { ok: false, msg: 'Sin API key' };
    const d = await this.fetchApi(`${APIFOOTBALL_BASE}/status`, {
      headers: { 'x-rapidapi-key': this.config.apifootballKey }
    }, { useProxy: true });
    return { ok: !!d?.response, msg: d?.response ? 'OK' : 'Error CORS/API' };
  }
}

// ========== PREDICTION ENGINE ==========
const PredictionEngine = {
  poissonProbability(lambda, k) {
    return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
  },
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
      mostLikelyScore: sorted[0], top5Scores: sorted.slice(0, 5), scoreProbabilities: sorted
    };
  },
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
    let under = 0;
    for (let t = 0; t <= 2; t++) {
      for (let h = 0; h <= t; h++) {
        under += this.poissonProbability(homeLambda, h) * this.poissonProbability(awayLambda, t - h);
      }
    }
    return 1 - under;
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
    const markets = [
      { market: `${fixture.homeTeam} gana`, prob: finalPred.homeWin, odds: data.marketHomeOdds },
      { market: 'Empate', prob: finalPred.draw, odds: data.marketDrawOdds },
      { market: `${fixture.awayTeam} gana`, prob: finalPred.awayWin, odds: data.marketAwayOdds },
      { market: 'Over 2.5 goles', prob: over25Prob, odds: data.over25Odds || 1.9 }
    ];
    const valueBets = markets.map(m => ({
      ...m,
      ...this.detectValueBet(m.prob, m.odds, config.minEdge),
      kelly: this.kellyCriterion(m.prob, m.odds, config.bankroll, config.kellyFraction)
    })).filter(v => v.isValueBet);
    return { features, base, adjusted: adj, prediction: finalPred, over25Prob, valueBets, data };
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
    const dark = document.documentElement.dataset.theme !== 'light';
    return { text: dark ? '#8892aa' : '#4a5570', grid: dark ? '#2a3148' : '#dde3ed' };
  },
  createProbDoughnut(canvasId, probs, labels) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined') return;
    const colors = this.chartColors();
    this.instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: probs.map(p => p * 100), backgroundColor: ['#00c853','#ff9800','#2196f3'], borderWidth: 0 }] },
      options: { plugins: { legend: { labels: { color: colors.text } } }, cutout: '60%' }
    });
  },
  createGoalsBar(canvasId, homeLambda, awayLambda) {
    this.destroy(canvasId);
    const ctx = document.getElementById(canvasId);
    if (!ctx || typeof Chart === 'undefined') return;
    const colors = this.chartColors();
    const labels = ['0','1','2','3','4','5+'];
    const homeData = [], awayData = [];
    for (let g = 0; g < 5; g++) {
      homeData.push(PredictionEngine.poissonProbability(homeLambda, g) * 100);
      awayData.push(PredictionEngine.poissonProbability(awayLambda, g) * 100);
    }
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
    if (!ctx || typeof Chart === 'undefined') return;
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
    if (!ctx || typeof Chart === 'undefined') return;
    const colors = this.chartColors();
    this.instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: history.map(h => h.week),
        datasets: [{ label: '% Acierto', data: history.map(h => h.accuracy), borderColor: '#00c853', backgroundColor: 'rgba(0,200,83,0.1)', fill: true, tension: 0.3 }]
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
        html += `<div class="heatmap-cell" style="background:rgba(0,200,83,${0.15 + intensity * 0.85})" title="${i}-${j}: ${pct(p)}">${p > 0.02 ? pct(p) : ''}</div>`;
      }
    }
    html += '</div>';
    el.innerHTML = html;
  }
};
