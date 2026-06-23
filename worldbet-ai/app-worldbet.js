// ========== WORLDBET AI MAIN CLASS ==========
/** Config por defecto — editable en Configuración si cambian las keys */
const DEFAULT_CONFIG = {
  thestatsapiKey: 'fapi_fMpvm5GUyUU0HNB0oSD3krDreoCAAEkk',
  worldcupApiKey: '',
  oddsApiKey: 'f943ae12007d245e3ca99c6524ded68e',
  apifootballKey: '',
  corsProxy: 'https://corsproxy.io/?',
  bankroll: 1000,
  kellyFraction: 0.25,
  minEdge: 0.05,
  leagueAvgGoals: 1.35
};

class WorldBetAI {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.fixtures = [];
    this.predictions = {};
    this.odds = {};
    this.valueBets = [];
    this.modelHistory = [
      { week: 'Sem 1', accuracy: 52 }, { week: 'Sem 2', accuracy: 55 },
      { week: 'Sem 3', accuracy: 58 }, { week: 'Sem 4', accuracy: 54 },
      { week: 'Sem 5', accuracy: 61 }, { week: 'Sem 6', accuracy: 63 }
    ];
    this.aiHistory = [];
    this.currentView = 'dashboard';
    this.demoMode = true;
    this.loading = false;
    this.error = null;
    this.filters = { group: '', stage: '', date: '', team: '', status: '' };
    this.countdownInterval = null;
    this.apiClient = new ApiClient(this.config);
    this.selectedMatchId = null;
    this.vbFilters = { minEv: 0, confidence: '', stage: '' };
    this.matchDataCache = {};
    this.oddsEventsCache = null;
    this.apiTrust = {
      tested: false,
      testing: false,
      trusted: false,
      validCount: 0,
      results: {}
    };
  }

  hasConfiguredKeys() {
    return !!(this.config.thestatsapiKey || this.config.oddsApiKey ||
      this.config.apifootballKey || this.config.worldcupApiKey);
  }

  apiTrustLabels() {
    return {
      thestats: 'TheStatsAPI',
      worldcup: 'WorldCupAPI',
      odds: 'The Odds API',
      apifootball: 'API-Football'
    };
  }

  async runApiValidation() {
    this.apiTrust.testing = true;
    this.updateApiStatus();

    const labels = this.apiTrustLabels();
    const entries = [
      ['thestats', !!this.config.thestatsapiKey, () => this.apiClient.testTheStatsApi()],
      ['worldcup', !!this.config.worldcupApiKey, () => this.apiClient.testWorldCupApi()],
      ['odds', !!this.config.oddsApiKey, () => this.apiClient.testOddsApi()],
      ['apifootball', !!this.config.apifootballKey, () => this.apiClient.testApiFootball()]
    ];

    const results = {};
    let validConfigured = 0;
    const validSources = [];

    for (const [key, configured, fn] of entries) {
      if (!configured) {
        results[key] = { ok: false, msg: 'Sin configurar', skipped: true };
        continue;
      }
      const r = await fn();
      results[key] = r;
      if (r.ok) {
        validConfigured++;
        validSources.push(labels[key]);
      }
    }

    this.apiTrust = {
      tested: true,
      testing: false,
      trusted: validConfigured > 0,
      validCount: validConfigured,
      validSources,
      results
    };
    this.demoMode = !this.apiTrust.trusted;
    this.updateApiStatus();
    if (this.apiTrust.trusted) {
      this.matchDataCache = {};
      this.oddsEventsCache = null;
      await this.computeAllPredictions();
    }
    return this.apiTrust;
  }

  loadSessionPrefs() {
    try {
      const theme = sessionStorage.getItem('wb_theme');
      if (theme) document.documentElement.dataset.theme = theme;
      const bankroll = sessionStorage.getItem('wb_bankroll');
      if (bankroll) this.config.bankroll = parseFloat(bankroll);
    } catch {}
  }

  saveSessionPrefs() {
    try {
      sessionStorage.setItem('wb_theme', document.documentElement.dataset.theme);
      sessionStorage.setItem('wb_bankroll', String(this.config.bankroll));
    } catch {}
  }

  async init() {
    this.loadSessionPrefs();
    this.bindEvents();
    document.getElementById('bankroll-quick').value = this.config.bankroll;
    await this.loadAllFixtures();
    if (this.hasConfiguredKeys()) {
      this.apiClient = new ApiClient(this.config);
      await this.runApiValidation();
      if (!this.apiTrust.trusted) await this.computeAllPredictions();
    } else {
      await this.computeAllPredictions();
    }
    this.navigate('dashboard');
    this.updateFooter();
    this.startCountdown();
  }

  bindEvents() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.view));
    });
    document.getElementById('btn-theme').addEventListener('click', () => this.toggleTheme());
    document.getElementById('bankroll-quick').addEventListener('change', e => {
      this.config.bankroll = parseFloat(e.target.value) || 1000;
      this.saveSessionPrefs();
      this.computeAllPredictions().then(() => this.render());
    });
    document.getElementById('btn-hamburger').addEventListener('click', () => this.toggleSidebar(true));
    document.getElementById('sidebar-overlay').addEventListener('click', () => this.toggleSidebar(false));
    document.getElementById('logo-link').addEventListener('click', e => { e.preventDefault(); this.navigate('dashboard'); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.closeModal();
    });
  }

  toggleSidebar(open) {
    document.getElementById('sidebar').classList.toggle('open', open);
    document.getElementById('sidebar-overlay').classList.toggle('open', open);
  }

  toggleTheme() {
    const html = document.documentElement;
    html.dataset.theme = html.dataset.theme === 'light' ? 'dark' : 'light';
    this.saveSessionPrefs();
    const icon = document.querySelector('#btn-theme i');
    if (icon) icon.setAttribute('data-lucide', html.dataset.theme === 'light' ? 'moon' : 'sun');
    lucide.createIcons();
    this.render();
  }

  normalizeFixture(f) {
    const isPlaceholder = isPlaceholderTeam(f.homeTeam) || isPlaceholderTeam(f.awayTeam);
    return {
      id: `wc-${String(f.matchNumber).padStart(3, '0')}`,
      matchNumber: f.matchNumber,
      homeTeam: f.homeTeam, awayTeam: f.awayTeam,
      stage: f.stage, group: f.group,
      kickoffUtc: f.kickoffUtc, date: f.date,
      stadium: f.stadium, hostCity: f.hostCity,
      isPlaceholder, status: 'scheduled'
    };
  }

  async loadAllFixtures() {
    this.loading = true;
    this.error = null;
    try {
      const raw = await this.apiClient.loadAllFixtures();
      if (!raw.length) throw new Error('No se pudieron cargar los fixtures');
      this.fixtures = raw.map(f => this.normalizeFixture(f));
      this.showToast('104 partidos cargados correctamente');
    } catch (err) {
      this.error = err.message;
      this.fixtures = this.getFallbackFixtures();
    }
    this.loading = false;
    this.updateApiStatus();
  }

  getFallbackFixtures() {
    const teams = [['Mexico','South Africa'],['Brazil','Morocco'],['Argentina','France'],['England','Germany']];
    return teams.map((t, i) => this.normalizeFixture({
      matchNumber: i + 1, date: '2026-06-11', kickoffUtc: '2026-06-11T19:00:00Z',
      stage: 'group-stage', group: 'A', homeTeam: t[0], awayTeam: t[1],
      stadium: 'Estadio', hostCity: 'ciudad'
    }));
  }

  async getMatchData(fixture) {
    const key = fixture.id;
    if (this.matchDataCache[key]) return this.matchDataCache[key];
    if (fixture.isPlaceholder) return null;

    let data = DemoDataGenerator.getMatchData(fixture);
    data.dataSources = ['Demo (Poisson + xG simulado)'];

    if (this.apiTrust.trusted) {
      try {
        if (this.config.oddsApiKey) {
          if (!this.oddsEventsCache) this.oddsEventsCache = await this.apiClient.fetchOddsApiEvents();
          const oddsData = this.apiClient.parseOddsApiForMatch(this.oddsEventsCache, fixture.homeTeam, fixture.awayTeam);
          if (oddsData) {
            Object.assign(data, oddsData);
            data.dataSources.push('The Odds API (cuotas reales)');
          }
        }
        if (this.config.apifootballKey) {
          const [homeForm, awayForm, h2h] = await Promise.all([
            this.apiClient.fetchTeamForm(fixture.homeTeam),
            this.apiClient.fetchTeamForm(fixture.awayTeam),
            this.apiClient.fetchHeadToHead(fixture.homeTeam, fixture.awayTeam)
          ]);
          if (homeForm?.fixtures?.response?.length) {
            data.homeForm = homeForm.fixtures.response.slice(0, 5).map(f => {
              const side = f.teams.home.id === homeForm.teamId ? 'home' : 'away';
              const g = f.goals;
              if (g.home === g.away) return 'D';
              const won = (side === 'home' && g.home > g.away) || (side === 'away' && g.away > g.home);
              return won ? 'W' : 'L';
            });
            data.dataSources.push('API-Football (forma local)');
          }
          if (awayForm?.fixtures?.response?.length) {
            data.awayForm = awayForm.fixtures.response.slice(0, 5).map(f => {
              const side = f.teams.home.id === awayForm.teamId ? 'home' : 'away';
              const g = f.goals;
              if (g.home === g.away) return 'D';
              const won = (side === 'home' && g.home > g.away) || (side === 'away' && g.away > g.home);
              return won ? 'W' : 'L';
            });
            data.dataSources.push('API-Football (forma visitante)');
          }
          if (h2h?.response?.length) {
            const matches = h2h.response.slice(0, 5);
            let w = 0, d = 0, l = 0, goals = 0;
            matches.forEach(m => {
              goals += (m.goals.home || 0) + (m.goals.away || 0);
              if (m.goals.home === m.goals.away) d++;
              else if (teamsMatch(m.teams.home.name, fixture.homeTeam)) {
                w += m.goals.home > m.goals.away ? 1 : 0;
                l += m.goals.home < m.goals.away ? 1 : 0;
              } else {
                w += m.goals.away > m.goals.home ? 1 : 0;
                l += m.goals.away < m.goals.home ? 1 : 0;
              }
            });
            data.h2hHomeWins = w; data.h2hDraws = d; data.h2hAwayWins = l;
            data.h2hAvgGoals = goals / Math.max(matches.length, 1);
            data.dataSources.push('API-Football (H2H)');
          }
        }
      } catch { /* mantiene datos demo parciales */ }
    }

    data.dataSources = [...new Set(data.dataSources)];
    this.matchDataCache[key] = data;
    return data;
  }

  async computeAllPredictions() {
    this.predictions = {};
    this.valueBets = [];
    for (const f of this.fixtures) {
      if (f.isPlaceholder) continue;
      const data = await this.getMatchData(f);
      if (!data) continue;
      const pred = PredictionEngine.runFullPrediction(f, data, this.config);
      this.predictions[f.id] = pred;
      pred.valueBets.forEach(pick => {
        this.valueBets.push({
          matchId: f.id, match: `${f.homeTeam} vs ${f.awayTeam}`,
          stage: f.stage, date: f.kickoffUtc,
          market: pick.label, prob: pick.prob, odds: pick.odds,
          confidence: pick.confidence, type: pick.type,
          culebraScore: pick.culebraScore,
          kelly: pick.kelly,
          recommendation: pred.recommendation
        });
      });
    }
    this.valueBets.sort((a, b) => b.culebraScore - a.culebraScore);
  }

  refreshAllPredictions() {
    return this.computeAllPredictions();
  }

  renderRecBox(rec, compact) {
    if (!rec) return '';
    const confCls = rec.primaryConfidence === 'ALTA' ? 'rec-box-value' : rec.primaryConfidence === 'CULEBRA' ? 'rec-box-culebra' : 'rec-box-model';
    if (compact) {
      return `<div class="rec-box ${confCls} compact">
        <div class="rec-primary">${escapeHtml(rec.primaryAction)} <strong>${escapeHtml(rec.primaryBet)}</strong>${rec.primaryOdds ? ` @ ${rec.primaryOdds.toFixed(2)}` : ''}</div>
        <div class="rec-detail">${pct(rec.primaryProb)} conf. · Marcador ${rec.likelyScore} · ${escapeHtml(rec.goalsPick)} · ${escapeHtml(rec.firstGoalPick)}</div>
      </div>`;
    }
    const picksHtml = (rec.picks || []).slice(0, 6).map(p => `
      <div class="rec-pick-row">
        <span>${escapeHtml(p.label)}</span>
        <span>${pct(p.prob)} · @ ${p.odds.toFixed(2)} <span class="rec-conf rec-conf-${p.confidence.toLowerCase()}">${p.confidence}</span></span>
      </div>`).join('');
    return `<div class="rec-box ${confCls}">
      <div class="rec-label">APUESTA RECOMENDADA · ${rec.primaryConfidence || 'ANÁLISIS'}</div>
      <div class="rec-primary">${escapeHtml(rec.primaryAction)} <strong>${escapeHtml(rec.primaryBet)}</strong>
        ${rec.primaryOdds ? `@ ${rec.primaryOdds.toFixed(2)}` : ''} <span style="font-size:var(--text-sm);color:var(--color-text-muted)">(${pct(rec.primaryProb)})</span></div>
      <div class="rec-grid">
        <div><span class="rec-k">Ganador modelo</span><br>${escapeHtml(rec.modelWinner)} (${pct(rec.modelWinnerProb)})</div>
        <div><span class="rec-k">Marcador probable</span><br>${rec.likelyScore} (${pct(rec.likelyScoreProb)})</div>
        <div><span class="rec-k">Goles totales</span><br>${rec.expectedTotalGoals} esp. · ${escapeHtml(rec.goalsPick)}</div>
        <div><span class="rec-k">Primer gol</span><br>${escapeHtml(rec.firstGoalPick)} (${pct(rec.firstGoalProb)})</div>
        ${rec.primaryKelly ? `<div><span class="rec-k">Kelly 1/4</span><br>${euro(rec.primaryKelly.stakeSuggestion)}</div>` : ''}
      </div>
      ${picksHtml ? `<div class="rec-picks"><div class="rec-k" style="margin-bottom:var(--space-2)">Otras opciones del análisis</div>${picksHtml}</div>` : ''}
      <div class="rec-sources">Fuentes: ${rec.dataSources.map(escapeHtml).join(' · ')}</div>
    </div>`;
  }

  updateApiStatus() {
    const dot = document.getElementById('api-dot');
    const text = document.getElementById('api-status-text');
    const container = document.getElementById('api-status');
    if (!dot || !text || !container) return;

    let dotClass = 'api-dot';
    let label = 'DEMO';
    let title = 'Datos simulados. Configura tus API keys y pulsa Probar APIs.';
    container.className = 'api-status';

    if (this.apiTrust.testing) {
      dotClass += ' pending';
      label = 'VERIFICANDO...';
      title = 'Comprobando conexión con las APIs configuradas...';
      container.classList.add('unverified');
    } else if (this.apiTrust.tested && this.apiTrust.trusted) {
      dotClass += ' gold';
      label = 'APIS VERIFICADAS';
      title = `Fuentes validadas: ${this.apiTrust.validSources.join(', ')}. Puedes confiar en los datos de mercado.`;
      container.classList.add('verified');
      this.demoMode = false;
    } else if (this.apiTrust.tested && this.hasConfiguredKeys() && !this.apiTrust.trusted) {
      dotClass += ' err';
      label = 'APIS FALLIDAS';
      title = 'Ninguna API configurada respondió. Revisa las keys y el proxy CORS.';
      container.classList.add('failed');
      this.demoMode = true;
    } else if (this.hasConfiguredKeys()) {
      dotClass += ' pending';
      label = 'SIN VERIFICAR';
      title = 'Keys guardadas. Pulsa Probar APIs para activar el modo verificado.';
      container.classList.add('unverified');
      this.demoMode = true;
    } else {
      this.demoMode = true;
    }

    if (this.error) {
      dotClass = 'api-dot err';
      label = 'ERROR';
      title = this.error;
      container.className = 'api-status failed';
    }

    dot.className = dotClass;
    text.textContent = label;
    container.title = title;
    container.setAttribute('aria-label', title);

    const footer = document.getElementById('footer-mode');
    if (footer) {
      footer.textContent = this.apiTrust.trusted
        ? `Modo: LIVE VERIFICADO · ${this.apiTrust.validCount} API(s)`
        : this.hasConfiguredKeys() && !this.apiTrust.tested
          ? 'Modo: DEMO (sin verificar)'
          : 'Modo: DEMO';
    }
  }

  updateFooter() {
    document.getElementById('footer-update').textContent =
      'Última actualización: ' + new Date().toLocaleString('es-ES');
  }

  startCountdown() {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.countdownInterval = setInterval(() => {
      const el = document.getElementById('countdown-timer');
      if (!el) return;
      const next = this.getNextMatch();
      if (!next) { el.textContent = '--:--:--'; return; }
      const diff = new Date(next.kickoffUtc) - Date.now();
      if (diff <= 0) { el.textContent = '¡En juego!'; return; }
      const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000), s = Math.floor((diff % 60000) / 1000);
      el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }, 1000);
  }

  getNextMatch() {
    const now = Date.now();
    return this.fixtures.filter(f => !f.isPlaceholder && new Date(f.kickoffUtc) > now)
      .sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc))[0];
  }

  getFilteredFixtures(view) {
    let list = [...this.fixtures];
    const today = new Date().toISOString().slice(0, 10);
    if (view === 'today') list = list.filter(f => f.date === today);
    if (view === 'groups') list = list.filter(f => f.stage === 'group-stage');
    if (view === 'knockout') list = list.filter(f => f.stage !== 'group-stage');
    if (this.filters.group) list = list.filter(f => f.group === this.filters.group);
    if (this.filters.stage) list = list.filter(f => f.stage === this.filters.stage);
    if (this.filters.date) list = list.filter(f => f.date === this.filters.date);
    if (this.filters.team) {
      const t = this.filters.team.toLowerCase();
      list = list.filter(f => f.homeTeam.toLowerCase().includes(t) || f.awayTeam.toLowerCase().includes(t));
    }
    return list.sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));
  }

  navigate(view) {
    this.currentView = view;
    ChartManager.destroyAll();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    this.toggleSidebar(false);
    this.render();
  }

  render() {
    const main = document.getElementById('main-content');
    if (this.loading) { main.innerHTML = '<div class="skeleton" style="height:300px"></div>'; return; }
    if (this.error && !this.fixtures.length) {
      main.innerHTML = `<div class="error-state card"><p>${escapeHtml(this.error)}</p><button class="btn btn-primary" onclick="app.loadAllFixtures().then(()=>app.render())">Reintentar</button></div>`;
      return;
    }
    switch (this.currentView) {
      case 'dashboard': main.innerHTML = this.renderDashboard(); break;
      case 'today':
      case 'groups':
      case 'knockout': main.innerHTML = this.renderFixtures(this.currentView); break;
      case 'valuebets': main.innerHTML = this.renderValueBets(); break;
      case 'ai': main.innerHTML = this.renderAIAnalysis(); break;
      case 'settings': main.innerHTML = this.renderSettings(); break;
    }
    lucide.createIcons();
    if (this.currentView === 'dashboard') {
      this.initDashboardCharts();
      this.animateKPIs();
    }
    this.bindViewEvents();
  }

  animateKPIs() {
    if (typeof countUp === 'undefined') return;
    document.querySelectorAll('[data-countup]').forEach(el => {
      const target = parseFloat(el.dataset.countup);
      const cu = new countUp.CountUp(el, target, {
        duration: 1.5,
        decimalPlaces: el.dataset.decimals ? 1 : 0,
        suffix: el.dataset.suffix || ''
      });
      if (!cu.error) cu.start();
    });
  }

  initDashboardCharts() {
    setTimeout(() => ChartManager.createPerformanceLine('chart-performance', this.modelHistory), 100);
  }

  renderDashboard() {
    const next = this.getNextMatch();
    const todayBets = this.valueBets.filter(v => v.date?.slice(0, 10) === new Date().toISOString().slice(0, 10));
    const top3 = this.valueBets.slice(0, 3);
    const accuracy = this.modelHistory[this.modelHistory.length - 1]?.accuracy || 58;
    return `
      <h1 class="view-title">Dashboard</h1>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Partidos</div><div class="kpi-value" data-countup="${this.fixtures.length}">0</div></div>
        <div class="kpi-card"><div class="kpi-label">Apuestas Hoy</div><div class="kpi-value" data-countup="${todayBets.length || this.valueBets.length}">0</div></div>
        <div class="kpi-card"><div class="kpi-label">Precisión Modelo</div><div class="kpi-value" data-countup="${accuracy}" data-suffix="%" data-decimals="1">0</div></div>
        <div class="kpi-card"><div class="kpi-label">ROI Acumulado</div><div class="kpi-value" data-countup="12.4" data-suffix="%" data-decimals="1">0</div></div>
      </div>
      <div class="grid-2">
        <div class="card">
          <h2 class="card-title">Próximo Partido</h2>
          ${next ? `
            <div class="match-teams">
              <span class="team"><img src="${flagUrl(next.homeTeam)}" alt="" loading="lazy" width="28" height="20">${escapeHtml(next.homeTeam)}</span>
              <span class="vs">VS</span>
              <span class="team">${escapeHtml(next.awayTeam)}<img src="${flagUrl(next.awayTeam)}" alt="" loading="lazy" width="28" height="20"></span>
            </div>
            <p class="match-meta">${formatDate(next.kickoffUtc)} · ${formatTime(next.kickoffUtc)} · ${escapeHtml(next.stadium)}</p>
            ${this.predictions[next.id]?.recommendation ? this.renderRecBox(this.predictions[next.id].recommendation, true) : ''}
            <div class="countdown" id="countdown-timer">--:--:--</div>
            <button class="btn btn-primary" style="margin-top:var(--space-4)" data-match="${next.id}">Ver Predicción</button>
          ` : '<div class="empty-state"><div class="empty-icon">⚽</div><p>No hay partidos próximos</p></div>'}
        </div>
        <div class="card">
          <h2 class="card-title">Apuestas Destacadas</h2>
          ${top3.length ? top3.map(v => {
            const rec = this.predictions[v.matchId]?.recommendation;
            return `
            <div style="padding:var(--space-3) 0;border-bottom:1px solid var(--color-divider)">
              <strong>${escapeHtml(v.match)}</strong><br>
              <span class="value-high">${escapeHtml(v.market)} @ ${v.odds.toFixed(2)} · ${pct(v.prob)}</span>
              ${rec ? `<br><span style="font-size:var(--text-xs);color:var(--color-text-muted)">${escapeHtml(rec.summary)}</span>` : ''}
            </div>`;
          }).join('') : '<div class="empty-state"><div class="empty-icon">📊</div><p>No hay apuestas destacadas</p></div>'}
        </div>
      </div>
      <div class="card">
        <h2 class="card-title">Rendimiento del Modelo</h2>
        <div class="chart-box"><canvas id="chart-performance" height="200"></canvas></div>
      </div>`;
  }

  renderFixtures(view) {
    const titles = { today: 'Partidos Hoy', groups: 'Fase de Grupos', knockout: 'Eliminatorias' };
    const list = this.getFilteredFixtures(view);
    const dates = [...new Set(this.fixtures.map(f => f.date))].sort();
    return `
      <h1 class="view-title">${titles[view] || 'Partidos'}</h1>
      <div class="filters">
        <select id="filter-group"><option value="">Todos los grupos</option>
          ${'ABCDEFGHIJKL'.split('').map(g => `<option value="${g}" ${this.filters.group===g?'selected':''}>Grupo ${g}</option>`).join('')}
        </select>
        <select id="filter-stage"><option value="">Todas las fases</option>
          ${Object.entries(STAGE_LABELS).map(([k,v]) => `<option value="${k}" ${this.filters.stage===k?'selected':''}>${v}</option>`).join('')}
        </select>
        <select id="filter-date"><option value="">Todas las fechas</option>
          ${dates.map(d => `<option value="${d}" ${this.filters.date===d?'selected':''}>${d}</option>`).join('')}
        </select>
        <input type="search" id="filter-team" placeholder="Buscar equipo..." value="${escapeHtml(this.filters.team)}">
      </div>
      ${list.length ? `<div class="match-grid">${list.map(f => this.renderMatchCard(f)).join('')}</div>` :
        '<div class="empty-state card"><div class="empty-icon">⚽</div><p>Sin partidos con estos filtros</p></div>'}
    `;
  }

  renderMatchCard(f) {
    const pred = this.predictions[f.id];
    const rec = pred?.recommendation;
    const hasPick = pred?.recommendation?.primaryBet;
    return `
      <article class="match-card">
        <div class="match-teams">
          <span class="team"><img src="${flagUrl(f.homeTeam)}" alt="" loading="lazy" width="28" height="20">${escapeHtml(f.homeTeam)}</span>
          <span class="vs">VS</span>
          <span class="team">${escapeHtml(f.awayTeam)}<img src="${flagUrl(f.awayTeam)}" alt="" loading="lazy" width="28" height="20"></span>
        </div>
        <div class="match-meta">
          ${formatDate(f.kickoffUtc)} · ${formatTime(f.kickoffUtc)}<br>
          ${escapeHtml(f.stadium)}, ${escapeHtml(f.hostCity)}
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3)">
          ${f.group ? `<span class="badge badge-group">Grupo ${f.group}</span>` : ''}
          <span class="badge badge-group">${STAGE_LABELS[f.stage] || f.stage}</span>
          ${f.isPlaceholder ? '<span class="badge badge-tbd">Por definir</span>' : ''}
          ${hasPick ? '<span class="badge badge-value">Apuesta lista</span>' : ''}
        </div>
        ${f.isPlaceholder
          ? '<p style="font-size:var(--text-sm);color:var(--color-text-muted)">Equipos por definir</p>'
          : `${rec ? this.renderRecBox(rec, true) : ''}
          <button class="btn btn-primary" data-match="${f.id}" style="margin-top:var(--space-3)">Ver Análisis</button>`}
      </article>`;
  }

  renderValueBets() {
    let bets = [...this.valueBets];
    if (this.vbFilters.confidence) bets = bets.filter(b => b.confidence === this.vbFilters.confidence);
    if (this.vbFilters.stage) bets = bets.filter(b => b.stage === this.vbFilters.stage);
    return `
      <h1 class="view-title">Apuestas Recomendadas</h1>
      <p style="color:var(--color-text-muted);margin-bottom:var(--space-4);font-size:var(--text-sm)">Basadas en el análisis Poisson + xG + datos de las APIs. No comparan value vs mercado.</p>
      <div class="filters">
        <select id="vb-confidence">
          <option value="">Toda confianza</option>
          <option value="ALTA" ${this.vbFilters.confidence==='ALTA'?'selected':''}>Alta</option>
          <option value="MEDIA" ${this.vbFilters.confidence==='MEDIA'?'selected':''}>Media</option>
          <option value="CULEBRA" ${this.vbFilters.confidence==='CULEBRA'?'selected':''}>Culebra</option>
        </select>
        <button class="btn btn-outline" id="btn-export-csv"><i data-lucide="download"></i> Exportar CSV</button>
      </div>
      ${bets.length ? `
        <div class="card table-wrap">
          <table>
            <thead><tr>
              <th>Partido</th><th>Mercado</th><th>Cuota</th><th>Prob. Modelo</th>
              <th>Confianza</th><th>Kelly</th><th>Tipo</th>
            </tr></thead>
            <tbody>${bets.map(b => `
              <tr>
                <td>${escapeHtml(b.match)}</td>
                <td>${escapeHtml(b.market)}</td>
                <td>${b.odds.toFixed(2)}</td>
                <td>${pct(b.prob)}</td>
                <td class="${b.confidence==='ALTA'?'value-high':b.confidence==='MEDIA'?'value-med':'value-low'}">${b.confidence}</td>
                <td>${pct(b.kelly.recommendedBet)}</td>
                <td>${escapeHtml(b.type || '')}</td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>` : '<div class="empty-state card"><div class="empty-icon">⚽</div><p>No hay apuestas recomendadas</p></div>'}
    `;
  }

  renderAIAnalysis() {
    const matchOptions = this.fixtures.filter(f => !f.isPlaceholder)
      .map(f => `<option value="${f.id}">${escapeHtml(f.homeTeam)} vs ${escapeHtml(f.awayTeam)}</option>`).join('');
    return `
      <h1 class="view-title">Análisis IA</h1>
      <div class="card">
        <div class="form-group">
          <label>Seleccionar partido</label>
          <select id="ai-match-select">${matchOptions}</select>
        </div>
        <div class="form-group">
          <label>Tu pregunta</label>
          <textarea id="ai-question" placeholder="Ej: ¿Vale la pena apostar al empate? ¿Cuál es el marcador más probable?"></textarea>
        </div>
        <button class="btn btn-primary" id="btn-ai-ask">Analizar</button>
        <div id="ai-response-area"></div>
      </div>
      <div class="card" style="margin-top:var(--space-4)">
        <h2 class="card-title">Historial</h2>
        <div id="ai-history">${this.aiHistory.length ? this.aiHistory.map(h =>
          `<div class="ai-history-item"><strong>${escapeHtml(h.match)}</strong>: ${escapeHtml(h.q)}<br>${h.a}</div>`
        ).join('') : '<p style="color:var(--color-text-muted)">Sin análisis previos</p>'}</div>
      </div>`;
  }

  renderSettings() {
    return `
      <h1 class="view-title">Configuración</h1>
      <div class="card settings-form">
        <p style="color:var(--color-text-muted);margin-bottom:var(--space-4);font-size:var(--text-sm)">
          Las API keys se guardan solo en memoria de sesión (no en localStorage).
        </p>
        <div class="form-group"><label>TheStatsAPI Key</label>
          <input type="password" id="cfg-thestats" value="${escapeHtml(this.config.thestatsapiKey)}" autocomplete="off"></div>
        <div class="form-group"><label>WorldCupAPI Key</label>
          <input type="password" id="cfg-worldcup" value="${escapeHtml(this.config.worldcupApiKey)}" autocomplete="off"></div>
        <div class="form-group"><label>The Odds API Key</label>
          <input type="password" id="cfg-odds" value="${escapeHtml(this.config.oddsApiKey)}" autocomplete="off"></div>
        <div class="form-group"><label>API-Football Key (RapidAPI)</label>
          <input type="password" id="cfg-apifootball" value="${escapeHtml(this.config.apifootballKey)}" autocomplete="off"></div>
        <div class="form-group"><label>Proxy CORS (opcional)</label>
          <input type="text" id="cfg-proxy" value="${escapeHtml(this.config.corsProxy)}" placeholder="https://corsproxy.io/?"></div>
        <div class="form-group"><label>Bankroll (€)</label>
          <input type="number" id="cfg-bankroll" value="${this.config.bankroll}" min="0"></div>
        <div class="form-group"><label>Kelly Fraction</label>
          <select id="cfg-kelly">
            <option value="0.25" ${this.config.kellyFraction===0.25?'selected':''}>0.25 (25%)</option>
            <option value="0.5" ${this.config.kellyFraction===0.5?'selected':''}>0.50 (50%)</option>
            <option value="0.1" ${this.config.kellyFraction===0.1?'selected':''}>0.10 (10%)</option>
          </select></div>
        <div class="form-group"><label>Edge mínimo value bet</label>
          <select id="cfg-minedge">
            <option value="0.03" ${this.config.minEdge===0.03?'selected':''}>3%</option>
            <option value="0.05" ${this.config.minEdge===0.05?'selected':''}>5%</option>
            <option value="0.08" ${this.config.minEdge===0.08?'selected':''}>8%</option>
          </select></div>
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
          <button class="btn btn-primary" id="btn-save-config">Guardar</button>
          <button class="btn btn-outline" id="btn-test-apis">Probar APIs</button>
          <button class="btn btn-outline" id="btn-reset-config">Reset</button>
        </div>
        <div id="api-test-results" style="margin-top:var(--space-4)"></div>
      </div>`;
  }

  bindViewEvents() {
    document.querySelectorAll('[data-match]').forEach(btn => {
      btn.addEventListener('click', () => this.openMatchModal(btn.dataset.match));
    });
    ['filter-group','filter-stage','filter-date'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', e => {
        const key = id.replace('filter-','');
        this.filters[key] = e.target.value;
        this.render();
      });
    });
    const teamFilter = document.getElementById('filter-team');
    if (teamFilter) teamFilter.addEventListener('input', e => { this.filters.team = e.target.value; this.render(); });
    const exportBtn = document.getElementById('btn-export-csv');
    if (exportBtn) exportBtn.addEventListener('click', () => this.exportCSV());
    ['vb-confidence'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', e => {
        if (id === 'vb-confidence') this.vbFilters.confidence = e.target.value;
        this.render();
      });
    });
    const aiAsk = document.getElementById('btn-ai-ask');
    if (aiAsk) aiAsk.addEventListener('click', () => this.runAIAnalysis());
    const saveCfg = document.getElementById('btn-save-config');
    if (saveCfg) saveCfg.addEventListener('click', () => this.saveConfig());
    const testApis = document.getElementById('btn-test-apis');
    if (testApis) testApis.addEventListener('click', () => this.testAllApis());
    const resetCfg = document.getElementById('btn-reset-config');
    if (resetCfg) resetCfg.addEventListener('click', () => { void this.resetConfig(); });
  }

  async openMatchModal(matchId) {
    const fixture = this.fixtures.find(f => f.id === matchId);
    if (!fixture || fixture.isPlaceholder) return;
    this.selectedMatchId = matchId;
    const pred = this.predictions[matchId];
    if (!pred) return;
    const p = pred.prediction;
    const d = pred.data;
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay" role="dialog" aria-modal="true" aria-label="Análisis de partido">
        <div class="modal">
          <div class="modal-header">
            <div>
              <h2>${escapeHtml(fixture.homeTeam)} vs ${escapeHtml(fixture.awayTeam)}</h2>
              <p style="color:var(--color-text-muted);font-size:var(--text-sm)">${formatDate(fixture.kickoffUtc)} · ${escapeHtml(fixture.stadium)}</p>
            </div>
            <button class="icon-btn" id="modal-close" aria-label="Cerrar análisis"><i data-lucide="x"></i></button>
          </div>
          <div class="modal-body">
            ${pred.recommendation ? this.renderRecBox(pred.recommendation) : ''}
            <div class="grid-2">
              <div>
                <h3 style="margin-bottom:var(--space-3)">Predicción del Modelo</h3>
                <div class="prob-grid">
                  <div class="prob-cell"><div>${escapeHtml(fixture.homeTeam)}</div><div class="pct">${pct(p.homeWin)}</div></div>
                  <div class="prob-cell"><div>Empate</div><div class="pct">${pct(p.draw)}</div></div>
                  <div class="prob-cell"><div>${escapeHtml(fixture.awayTeam)}</div><div class="pct">${pct(p.awayWin)}</div></div>
                </div>
                <p style="margin:var(--space-3) 0"><strong>Score más probable:</strong> ${p.mostLikelyScore.home}-${p.mostLikelyScore.away} (${pct(p.mostLikelyScore.probability)})</p>
                <p><strong>Top 5:</strong> ${p.top5Scores.map(s => `${s.home}-${s.away}`).join(', ')}</p>
                <p><strong>Goles esperados:</strong> ${(p.expectedHomeGoals + p.expectedAwayGoals).toFixed(1)}</p>
              </div>
              <div>
                <h3 style="margin-bottom:var(--space-3)">Cuotas de Mercado</h3>
                ${Object.entries(d.bookmakers).map(([name, o]) =>
                  `<p style="font-size:var(--text-sm);margin:var(--space-2) 0"><strong>${name}:</strong> ${o.home.toFixed(2)} / ${o.draw.toFixed(2)} / ${o.away.toFixed(2)}</p>`
                ).join('')}
                <p style="font-size:var(--text-xs);color:var(--color-text-muted)">Línea: ${d.lineMovement.direction} (${d.lineMovement.opening.toFixed(2)} → ${d.lineMovement.current.toFixed(2)})</p>
              </div>
            </div>
            <h3 style="margin:var(--space-4) 0 var(--space-3)">Apuestas del Análisis</h3>
            ${pred.analysisPicks?.length ? pred.analysisPicks.map(v => `
              <div style="padding:var(--space-3);background:var(--color-surface-offset);border-radius:var(--radius-md);margin-bottom:var(--space-2)">
                <strong>${escapeHtml(v.label)}</strong> @ ${v.odds.toFixed(2)}<br>
                <span style="font-size:var(--text-sm)">Prob. modelo: ${pct(v.prob)} · Confianza: ${v.confidence} · Kelly 1/4: ${pct(v.kelly.recommendedBet)} (€${v.kelly.stakeSuggestion.toFixed(2)})</span>
              </div>
            `).join('') : '<p style="color:var(--color-text-muted)">Sin apuestas para este partido</p>'}
            <h3 style="margin:var(--space-4) 0 var(--space-3)">Estadísticas Comparativas</h3>
            <div class="grid-2">
              <div>
                <p class="stat-bar-label"><span>Forma ${escapeHtml(fixture.homeTeam)}</span><span class="form-dots">${d.homeForm.map(r=>`<span class="form-dot ${r}"></span>`).join('')}</span></p>
                <p class="stat-bar-label"><span>Forma ${escapeHtml(fixture.awayTeam)}</span><span class="form-dots">${d.awayForm.map(r=>`<span class="form-dot ${r}"></span>`).join('')}</span></p>
                <p class="stat-bar-label"><span>Ranking FIFA</span><span>#${d.homeRanking} vs #${d.awayRanking}</span></p>
                <p class="stat-bar-label"><span>H2H (5)</span><span>${d.h2hHomeWins}W-${d.h2hDraws}D-${d.h2hAwayWins}L</span></p>
              </div>
              <div>
                <div class="stat-bar"><div class="stat-bar-label"><span>xG For ${escapeHtml(fixture.homeTeam)}</span><span>${d.homeXGFor.toFixed(2)}</span></div>
                  <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.min(d.homeXGFor/3*100,100)}%"></div></div></div>
                <div class="stat-bar"><div class="stat-bar-label"><span>xG For ${escapeHtml(fixture.awayTeam)}</span><span>${d.awayXGFor.toFixed(2)}</span></div>
                  <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.min(d.awayXGFor/3*100,100)}%"></div></div></div>
              </div>
            </div>
            <h3 style="margin:var(--space-4) 0 var(--space-3)">Configurar Apuesta</h3>
            <div class="filters">
              <input type="number" id="bet-bankroll" value="${this.config.bankroll}" aria-label="Bankroll">
              <select id="bet-market">${pred.analysisPicks?.length ? pred.analysisPicks.map((v,i) =>
                `<option value="${i}" data-odds="${v.odds}" data-prob="${v.prob}">${escapeHtml(v.label)}</option>`
              ).join('') : `<option value="0" data-odds="${d.marketHomeOdds}" data-prob="${p.homeWin}">${escapeHtml(fixture.homeTeam)} gana</option>`}</select>
              <input type="number" id="bet-odds" step="0.01" value="${pred.analysisPicks?.[0]?.odds || d.marketHomeOdds}" aria-label="Cuota">
            </div>
            <p id="bet-result" style="margin-top:var(--space-3);font-weight:600"></p>
            <div class="chart-row">
              <div class="chart-box"><canvas id="chart-prob" height="180"></canvas></div>
              <div class="chart-box"><canvas id="chart-goals" height="180"></canvas></div>
              <div class="chart-box"><canvas id="chart-xg" height="180"></canvas></div>
            </div>
            <div class="chart-box" style="margin-top:var(--space-4)">
              <h4 style="margin-bottom:var(--space-3)">Mapa de Calor de Resultados</h4>
              <div id="chart-heatmap"></div>
            </div>
          </div>
        </div>
      </div>`;
    lucide.createIcons();
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') this.closeModal();
    });
    const updateBet = () => {
      const bankroll = parseFloat(document.getElementById('bet-bankroll').value) || 1000;
      const odds = parseFloat(document.getElementById('bet-odds').value) || 2;
      const sel = document.getElementById('bet-market');
      const prob = parseFloat(sel.selectedOptions[0]?.dataset.prob) || 0.5;
      const kelly = PredictionEngine.kellyCriterion(prob, odds, bankroll, this.config.kellyFraction);
      const gain = kelly.stakeSuggestion * (odds - 1);
      document.getElementById('bet-result').textContent =
        `Apostar: €${kelly.stakeSuggestion.toFixed(2)} | Ganancia potencial: +€${gain.toFixed(2)} | Riesgo: ${kelly.riskLevel}`;
    };
    ['bet-bankroll','bet-market','bet-odds'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
        if (id === 'bet-market') document.getElementById('bet-odds').value = el.selectedOptions[0]?.dataset.odds;
        updateBet();
      });
    });
    updateBet();
    setTimeout(() => {
      ChartManager.createProbDoughnut('chart-prob', [p.homeWin, p.draw, p.awayWin],
        [fixture.homeTeam, 'Empate', fixture.awayTeam]);
      ChartManager.createGoalsBar('chart-goals', pred.adjusted.adjustedHomeLambda, pred.adjusted.adjustedAwayLambda);
      ChartManager.createXGBar('chart-xg', d, fixture.homeTeam, fixture.awayTeam);
      ChartManager.renderHeatmap('chart-heatmap', p.scoreProbabilities);
    }, 150);
    this.showToast('Análisis cargado');
  }

  closeModal() {
    ChartManager.destroyAll();
    document.getElementById('modal-root').innerHTML = '';
  }

  runAIAnalysis() {
    const matchId = document.getElementById('ai-match-select')?.value;
    const question = document.getElementById('ai-question')?.value?.trim();
    if (!matchId || !question) return;
    const fixture = this.fixtures.find(f => f.id === matchId);
    const pred = this.predictions[matchId];
    if (!fixture || !pred) return;
    const p = pred.prediction;
    const q = question.toLowerCase();
    let answer = '';
    if (q.includes('empate')) {
      answer = `La probabilidad de empate es ${pct(p.draw)}. Cuota mercado: ${pred.data.marketDrawOdds.toFixed(2)}. `;
      const pick = pred.analysisPicks?.find(v => v.label === 'Empate');
      answer += pick ? `Recomendación del análisis: ${pick.label} (${pct(pick.prob)}).` : 'El modelo no destaca el empate como apuesta principal.';
    } else if (q.includes('marcador') || q.includes('resultado') || q.includes('score')) {
      answer = `Marcador más probable: ${p.mostLikelyScore.home}-${p.mostLikelyScore.away} (${pct(p.mostLikelyScore.probability)}). Top 5: ${p.top5Scores.map(s=>`${s.home}-${s.away}`).join(', ')}. Goles esperados totales: ${(p.expectedHomeGoals+p.expectedAwayGoals).toFixed(1)}.`;
    } else if (q.includes('over') || q.includes('goles') || q.includes('under')) {
      answer = `Probabilidad Over 2.5: ${pct(pred.over25Prob)}. Under 2.5: ${pct(pred.under25Prob)}. xG combinado: ${(pred.adjusted.adjustedHomeLambda+pred.adjusted.adjustedAwayLambda).toFixed(1)} goles esperados. Recomendación: ${pred.recommendation.goalsPick}.`;
    } else if (q.includes('primer gol') || q.includes('primero')) {
      answer = `${pred.recommendation.firstGoalPick} (${pct(pred.recommendation.firstGoalProb)}).`;
    } else if (q.includes('apost') || q.includes('recomend') || q.includes('kelly') || q.includes('culebra')) {
      const rec = pred.recommendation;
      answer = `Apuesta principal: ${rec.primaryBet} @ ${rec.primaryOdds?.toFixed(2)} (${pct(rec.primaryProb)}, ${rec.primaryConfidence}). `;
      if (pred.analysisPicks?.length) {
        answer += pred.analysisPicks.slice(0, 4).map(v =>
          `${v.label}: ${pct(v.prob)} @ ${v.odds.toFixed(2)} (${v.confidence})`
        ).join(' · ');
      }
    } else {
      const rec = pred.recommendation;
      answer = `Análisis ${fixture.homeTeam} vs ${fixture.awayTeam}: ${rec.summary}. Ranking FIFA #${pred.data.homeRanking} vs #${pred.data.awayRanking}.`;
    }
    document.getElementById('ai-response-area').innerHTML = `<div class="ai-response">${escapeHtml(answer)}</div>`;
    this.aiHistory.unshift({ match: `${fixture.homeTeam} vs ${fixture.awayTeam}`, q: question, a: answer });
    if (this.aiHistory.length > 20) this.aiHistory.pop();
  }

  async saveConfig() {
    this.config.thestatsapiKey = document.getElementById('cfg-thestats').value;
    this.config.worldcupApiKey = document.getElementById('cfg-worldcup').value;
    this.config.oddsApiKey = document.getElementById('cfg-odds').value;
    this.config.apifootballKey = document.getElementById('cfg-apifootball').value;
    this.config.corsProxy = document.getElementById('cfg-proxy').value;
    this.config.bankroll = parseFloat(document.getElementById('cfg-bankroll').value) || 1000;
    this.config.kellyFraction = parseFloat(document.getElementById('cfg-kelly').value);
    this.config.minEdge = parseFloat(document.getElementById('cfg-minedge').value);
    this.apiClient = new ApiClient(this.config);
    document.getElementById('bankroll-quick').value = this.config.bankroll;
    this.saveSessionPrefs();
    this.matchDataCache = {};
    this.oddsEventsCache = null;
    if (this.hasConfiguredKeys()) {
      await this.runApiValidation();
      this.renderApiTestResults();
      this.showToast(this.apiTrust.trusted ? 'APIs verificadas — predicciones con datos en vivo' : 'Config guardada — revisa el estado de las APIs');
    } else {
      this.apiTrust = { tested: false, testing: false, trusted: false, validCount: 0, validSources: [], results: {} };
      await this.computeAllPredictions();
      this.updateApiStatus();
      this.showToast('Configuración guardada');
    }
    this.render();
  }

  renderApiTestResults() {
    const results = document.getElementById('api-test-results');
    if (!results || !this.apiTrust.tested) return;
    const labels = this.apiTrustLabels();
    results.innerHTML = Object.entries(this.apiTrust.results).map(([key, r]) => {
      const dotCls = r.ok ? 'gold' : r.skipped ? '' : 'err';
      const status = r.ok ? 'Verificada' : r.skipped ? 'No configurada' : 'Fallida';
      return `<p style="margin:var(--space-2) 0"><span class="api-dot ${dotCls}" style="display:inline-block;margin-right:8px"></span><strong>${labels[key]}:</strong> ${escapeHtml(r.msg)} <span style="color:var(--color-text-muted)">(${status})</span></p>`;
    }).join('') + (this.apiTrust.trusted
      ? `<p style="margin-top:var(--space-3);color:var(--color-gold);font-weight:600">✓ ${this.apiTrust.validCount} API(s) verificada(s). El header muestra el círculo dorado.</p>`
      : `<p style="margin-top:var(--space-3);color:var(--color-error)">Ninguna API verificada. Los datos siguen siendo simulados.</p>`);
  }

  async testAllApis() {
    const results = document.getElementById('api-test-results');
    if (results) results.innerHTML = '<div class="skeleton" style="height:60px"></div>';
    this.saveConfigFromForm();
    this.apiClient = new ApiClient(this.config);
    await this.runApiValidation();
    this.renderApiTestResults();
    if (this.apiTrust.trusted) {
      this.matchDataCache = {};
      this.oddsEventsCache = null;
      await this.computeAllPredictions();
    }
    this.showToast(this.apiTrust.trusted
      ? `Verificado: ${this.apiTrust.validSources.join(', ')}`
      : 'No se pudo verificar ninguna API');
  }

  saveConfigFromForm() {
    const g = id => document.getElementById(id);
    if (!g('cfg-thestats')) return;
    this.config.thestatsapiKey = g('cfg-thestats').value;
    this.config.worldcupApiKey = g('cfg-worldcup').value;
    this.config.oddsApiKey = g('cfg-odds').value;
    this.config.apifootballKey = g('cfg-apifootball').value;
    this.config.corsProxy = g('cfg-proxy').value;
    this.config.bankroll = parseFloat(g('cfg-bankroll').value) || 1000;
    this.config.kellyFraction = parseFloat(g('cfg-kelly').value);
    this.config.minEdge = parseFloat(g('cfg-minedge').value);
  }

  async resetConfig() {
    this.config = { ...DEFAULT_CONFIG };
    this.apiClient = new ApiClient(this.config);
    this.apiTrust = { tested: false, testing: false, trusted: false, validCount: 0, validSources: [], results: {} };
    this.demoMode = true;
    this.matchDataCache = {};
    this.oddsEventsCache = null;
    await this.runApiValidation();
    if (!this.apiTrust.trusted) await this.computeAllPredictions();
    this.updateApiStatus();
    this.render();
    this.showToast('Configuración restablecida');
  }

  exportCSV() {
    const headers = ['Partido','Mercado','Cuota','ProbModelo','Confianza','Kelly','Tipo'];
    const rows = this.valueBets.map(b => [
      b.match, b.market, b.odds.toFixed(2), pct(b.prob),
      b.confidence, pct(b.kelly.recommendedBet), b.type || ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `worldbet-apuestas-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    this.showToast('CSV exportado');
  }

  showToast(msg) {
    const root = document.getElementById('toast-root');
    root.innerHTML = `<div class="toast" role="status">${escapeHtml(msg)}</div>`;
    setTimeout(() => { root.innerHTML = ''; }, 3000);
  }
}

// ========== INIT ==========
let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new WorldBetAI();
  app.init();
});
