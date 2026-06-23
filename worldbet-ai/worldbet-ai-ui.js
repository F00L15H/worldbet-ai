// ========== WORLDBET AI APP ==========
class WorldBetAI {
  constructor() {
    this.config = {
      thestatsapiKey: '', worldcupApiKey: '', oddsApiKey: '', apifootballKey: '',
      corsProxy: '', bankroll: 1000, kellyFraction: 0.25, minEdge: 0.05, leagueAvgGoals: 1.35
    };
    this.fixtures = [];
    this.predictions = {};
    this.matchDataCache = {};
    this.odds = {};
    this.valueBets = [];
    this.modelHistory = [];
    this.aiHistory = [];
    this.currentView = 'dashboard';
    this.filters = { group: '', stage: '', date: '', team: '', status: '', minEV: 0, confidence: '' };
    this.apiStatus = { fixtures: 'pending', thestats: 'idle', worldcup: 'idle', odds: 'idle', apifootball: 'idle' };
    this.lastUpdate = null;
    this.countdownTimer = null;
    this.oddsEventsCache = null;
    this.api = new ApiClient(this.config);
    this.valueBetFilters = { minEV: 0, confidence: '', stage: '' };
    this.apiTrust = { tested: false, testing: false, trusted: false, validCount: 0, validSources: [], results: {} };
  }

  isDemoMode() {
    return !this.apiTrust.trusted;
  }

  hasLiveKeys() {
    return !!(this.config.thestatsapiKey || this.config.oddsApiKey || this.config.apifootballKey || this.config.worldcupApiKey);
  }

  apiTrustLabels() {
    return { thestats: 'TheStatsAPI', worldcup: 'WorldCupAPI', odds: 'The Odds API', apifootball: 'API-Football' };
  }

  async runApiValidation() {
    this.apiTrust.testing = true;
    this.updateTrustBadge();
    const labels = this.apiTrustLabels();
    const entries = [
      ['thestats', !!this.config.thestatsapiKey, () => this.api.testTheStatsApi()],
      ['worldcup', !!this.config.worldcupApiKey, () => this.api.testWorldCupApi()],
      ['odds', !!this.config.oddsApiKey, () => this.api.testOddsApi()],
      ['apifootball', !!this.config.apifootballKey, () => this.api.testApiFootball()]
    ];
    const results = {};
    let validConfigured = 0;
    const validSources = [];
    for (const [key, configured, fn] of entries) {
      if (!configured) { results[key] = { ok: false, msg: 'Sin configurar', skipped: true }; continue; }
      const r = await fn();
      results[key] = r;
      if (r.ok) { validConfigured++; validSources.push(labels[key]); }
    }
    this.apiTrust = { tested: true, testing: false, trusted: validConfigured > 0, validCount: validConfigured, validSources, results };
    this.apiStatus = {
      fixtures: this.apiStatus.fixtures,
      thestats: results.thestats?.ok ? 'ok' : results.thestats?.skipped ? 'idle' : 'err',
      worldcup: results.worldcup?.ok ? 'ok' : results.worldcup?.skipped ? 'idle' : 'err',
      odds: results.odds?.ok ? 'ok' : results.odds?.skipped ? 'idle' : 'err',
      apifootball: results.apifootball?.ok ? 'ok' : results.apifootball?.skipped ? 'idle' : 'err'
    };
    this.updateTrustBadge();
    this.updateApiStatusBar();
    return this.apiTrust;
  }

  updateTrustBadge() {
    const badge = document.getElementById('apiTrustBadge');
    const text = document.getElementById('apiTrustText');
    if (!badge || !text) return;
    let label = 'DEMO';
    let title = 'Datos simulados. Configura y prueba las APIs.';
    badge.className = 'api-trust-badge demo';
    if (this.apiTrust.testing) {
      label = 'VERIFICANDO...';
      title = 'Comprobando APIs...';
      badge.className = 'api-trust-badge testing';
    } else if (this.apiTrust.tested && this.apiTrust.trusted) {
      label = 'APIS VERIFICADAS';
      title = `Fuentes validadas: ${this.apiTrust.validSources.join(', ')}`;
      badge.className = 'api-trust-badge verified';
    } else if (this.apiTrust.tested && this.hasLiveKeys()) {
      label = 'APIS FALLIDAS';
      title = 'Ninguna API respondió. Revisa keys y proxy CORS.';
      badge.className = 'api-trust-badge failed';
    } else if (this.hasLiveKeys()) {
      label = 'SIN VERIFICAR';
      title = 'Pulsa Probar APIs para verificar.';
      badge.className = 'api-trust-badge unverified';
    }
    text.textContent = label;
    badge.title = title;
    badge.setAttribute('aria-label', title);
  }

  normalizeFixture(raw, index) {
    const home = normalizeTeamName(raw.homeTeam || raw.home_team || raw.home || '');
    const away = normalizeTeamName(raw.awayTeam || raw.away_team || raw.away || '');
    let dateStr = raw.date || raw.kickoff || raw.datetime || '';
    if (raw.time && dateStr && !dateStr.includes('T')) dateStr += 'T' + raw.time + ':00Z';
    if (dateStr && !dateStr.endsWith('Z') && !dateStr.includes('+')) dateStr += 'Z';
    return {
      id: String(raw.id || raw.match_id || `match-${raw.matchNumber || raw.match_number || index + 1}`),
      matchNumber: raw.matchNumber || raw.match_number || index + 1,
      homeTeam: home, awayTeam: away,
      date: dateStr || new Date().toISOString(),
      stage: raw.stage || raw.round || 'group-stage',
      group: raw.group || raw.group_label || raw.groupLabel || '',
      stadium: raw.stadium || raw.venue || '',
      city: raw.city || '',
      status: raw.status || 'scheduled',
      thestatsId: raw.thestats_id || raw.match_id || null
    };
  }

  generateDemoHistory() {
    const rand = seededRandom(42);
    return Array.from({ length: 8 }, (_, i) => ({
      week: `Sem ${i + 1}`,
      accuracy: Math.round(55 + rand() * 13)
    }));
  }

  async init() {
    const theme = sessionStorage.getItem('wbai-theme') || 'dark';
    document.documentElement.dataset.theme = theme;
    this.updateThemeIcon();
    this.bindEvents();
    this.modelHistory = this.generateDemoHistory();
    this.showSkeleton(document.getElementById('mainContent'));
    try {
      await this.loadAllFixtures();
      await this.computeAllPredictions();
      this.lastUpdate = new Date();
      this.apiStatus.fixtures = this.fixtures.length > 8 ? 'ok' : 'warn';
    } catch (e) {
      this.apiStatus.fixtures = 'err';
      this.fixtures = FALLBACK_FIXTURES;
      await this.computeAllPredictions();
    }
    this.switchView('dashboard');
    this.updateApiStatusBar();
    this.updateTrustBadge();
    this.updateStatusBar();
    this.startCountdown();
    if (window.lucide) lucide.createIcons();
  }

  async loadAllFixtures() {
    const raw = await this.api.loadAllFixtures();
    if (Array.isArray(raw) && raw.length) {
      this.fixtures = raw.map((f, i) => this.normalizeFixture(f, i));
    } else {
      this.fixtures = FALLBACK_FIXTURES.map((f, i) => this.normalizeFixture(f, i));
    }
  }

  async getMatchData(fixture) {
    const key = fixture.id;
    if (this.matchDataCache[key]) return this.matchDataCache[key];
    if (isPlaceholderTeam(fixture.homeTeam) || isPlaceholderTeam(fixture.awayTeam)) return null;

    let data = null;
    const hasKeys = this.hasLiveKeys();

    if (hasKeys) {
      try {
        data = DemoDataGenerator.getMatchData(fixture);
        data.isDemo = false;

        if (this.config.oddsApiKey) {
          if (!this.oddsEventsCache) this.oddsEventsCache = await this.api.fetchOddsApiEvents();
          const oddsData = this.api.parseOddsApiForMatch(this.oddsEventsCache, fixture.homeTeam, fixture.awayTeam);
          if (oddsData) Object.assign(data, oddsData);
        }

        if (this.config.thestatsapiKey && fixture.thestatsId) {
          const stats = await this.api.fetchMatchStats(fixture.thestatsId);
          if (stats?.data) {
            const xg = stats.data;
            if (xg.home_xg) data.homeXGFor = xg.home_xg;
            if (xg.away_xg) data.awayXGFor = xg.away_xg;
          }
        }

        if (this.config.apifootballKey) {
          const [homeForm, awayForm, h2h] = await Promise.all([
            this.api.fetchTeamForm(fixture.homeTeam),
            this.api.fetchTeamForm(fixture.awayTeam),
            this.api.fetchHeadToHead(fixture.homeTeam, fixture.awayTeam)
          ]);
          if (homeForm?.fixtures?.response) {
            data.homeForm = homeForm.fixtures.response.slice(0, 5).map(f => {
              const t = f.teams.home.id === homeForm.teamId ? 'home' : 'away';
              const g = f.goals;
              if (g.home === g.away) return 'D';
              const won = (t === 'home' && g.home > g.away) || (t === 'away' && g.away > g.home);
              return won ? 'W' : 'L';
            });
          }
          if (awayForm?.fixtures?.response) {
            data.awayForm = awayForm.fixtures.response.slice(0, 5).map(f => {
              const t = f.teams.home.id === awayForm.teamId ? 'home' : 'away';
              const g = f.goals;
              if (g.home === g.away) return 'D';
              const won = (t === 'home' && g.home > g.away) || (t === 'away' && g.away > g.home);
              return won ? 'W' : 'L';
            });
          }
          if (h2h?.response?.length) {
            const matches = h2h.response.slice(0, 5);
            let w = 0, d = 0, l = 0, goals = 0;
            matches.forEach(m => {
              goals += (m.goals.home || 0) + (m.goals.away || 0);
              const homeId = m.teams.home.name;
              if (m.goals.home === m.goals.away) d++;
              else if (teamsMatch(homeId, fixture.homeTeam)) w += m.goals.home > m.goals.away ? 1 : 0, l += m.goals.home < m.goals.away ? 1 : 0;
              else w += m.goals.away > m.goals.home ? 1 : 0, l += m.goals.away < m.goals.home ? 1 : 0;
            });
            data.h2hHomeWins = w; data.h2hDraws = d; data.h2hAwayWins = l;
            data.h2hAvgGoals = goals / Math.max(matches.length, 1);
          }
        }
      } catch {
        data = DemoDataGenerator.getMatchData(fixture);
      }
    } else {
      data = DemoDataGenerator.getMatchData(fixture);
    }

    this.matchDataCache[key] = data;
    return data;
  }

  async computeAllPredictions() {
    this.predictions = {};
    this.valueBets = [];
    for (const fixture of this.fixtures) {
      if (isPlaceholderTeam(fixture.homeTeam) || isPlaceholderTeam(fixture.awayTeam)) continue;
      const data = await this.getMatchData(fixture);
      if (!data) continue;
      const pred = PredictionEngine.runFullPrediction(fixture, data, this.config);
      this.predictions[fixture.id] = pred;
      pred.valueBets.forEach(vb => {
        this.valueBets.push({ ...vb, fixture, matchId: fixture.id });
      });
    }
    this.valueBets.sort((a, b) => b.expectedValue - a.expectedValue);
  }

  refreshAllValueBets() {
    this.valueBets = [];
    Object.entries(this.predictions).forEach(([matchId, pred]) => {
      const fixture = this.fixtures.find(f => f.id === matchId);
      if (!fixture) return;
      pred.valueBets.forEach(vb => this.valueBets.push({ ...vb, fixture, matchId }));
    });
    this.valueBets.sort((a, b) => b.expectedValue - a.expectedValue);
  }

  bindEvents() {
    document.getElementById('mainNav').addEventListener('click', e => {
      const btn = e.target.closest('[data-view]');
      if (btn) { this.switchView(btn.dataset.view); this.closeSidebar(); }
    });
    document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());
    document.getElementById('menuToggle').addEventListener('click', () => this.toggleSidebar());
    document.getElementById('sidebarOverlay').addEventListener('click', () => this.closeSidebar());
    document.getElementById('closeModal').addEventListener('click', () => this.closeMatchModal());
    document.getElementById('matchModal').addEventListener('click', e => {
      if (e.target.id === 'matchModal') this.closeMatchModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { this.closeMatchModal(); this.closeSidebar(); }
    });
    window.addEventListener('hashchange', () => {
      const view = location.hash.replace('#', '');
      if (view) this.switchView(view, false);
    });
  }

  toggleTheme() {
    const html = document.documentElement;
    html.dataset.theme = html.dataset.theme === 'light' ? 'dark' : 'light';
    sessionStorage.setItem('wbai-theme', html.dataset.theme);
    this.updateThemeIcon();
    if (this.currentView === 'dashboard') this.renderDashboard();
  }

  updateThemeIcon() {
    const icon = document.querySelector('#themeToggle i');
    if (icon) icon.setAttribute('data-lucide', document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun');
    if (window.lucide) lucide.createIcons();
  }

  toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('open');
  }
  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
  }

  switchView(view, setHash = true) {
    this.currentView = view;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    if (setHash) location.hash = view;
    const main = document.getElementById('mainContent');
    switch (view) {
      case 'dashboard': this.renderDashboard(); break;
      case 'today': this.filters = { ...this.filters, stage: '' }; this.renderFixtures('today'); break;
      case 'groups': this.filters = { ...this.filters, stage: 'group-stage' }; this.renderFixtures('groups'); break;
      case 'knockout': this.filters = { ...this.filters, stage: 'knockout' }; this.renderFixtures('knockout'); break;
      case 'value-bets': this.renderValueBets(); break;
      case 'ai-analysis': this.renderAIAnalysis(); break;
      case 'settings': this.renderSettings(); break;
      default: this.renderDashboard();
    }
    document.getElementById('bankrollBadge').textContent = euro(this.config.bankroll);
    if (window.lucide) lucide.createIcons();
  }

  showSkeleton(container) {
    if (!container) return;
    container.innerHTML = `<div class="kpi-grid">${Array(4).fill('<div class="kpi-card skeleton" style="height:100px"></div>').join('')}</div>
      <div class="grid-2"><div class="card skeleton" style="height:200px"></div><div class="card skeleton" style="height:200px"></div></div>`;
  }

  showError(container, msg, retryFn) {
    container.innerHTML = `<div class="error-state card"><div class="icon">⚠️</div><p>${escapeHtml(msg)}</p>
      ${retryFn ? '<button class="btn btn-primary" id="retryBtn">Reintentar</button>' : ''}</div>`;
    if (retryFn) document.getElementById('retryBtn')?.addEventListener('click', retryFn);
  }

  showEmpty(container, msg, icon = '⚽') {
    container.innerHTML = `<div class="empty-state"><div class="icon">${icon}</div><p>${escapeHtml(msg)}</p></div>`;
  }

  getNextMatch() {
    const now = Date.now();
    return this.fixtures
      .filter(f => !isPlaceholderTeam(f.homeTeam) && new Date(f.date).getTime() > now)
      .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
  }

  getTodayFixtures() {
    const today = new Date().toDateString();
    return this.fixtures.filter(f => new Date(f.date).toDateString() === today);
  }

  filterFixtures(mode) {
    let list = [...this.fixtures];
    if (mode === 'today') list = this.getTodayFixtures();
    else if (mode === 'groups') list = list.filter(f => f.stage === 'group-stage' || f.stage?.includes('group'));
    else if (mode === 'knockout') list = list.filter(f => f.stage && !f.stage.includes('group') && f.stage !== 'group-stage');

    const g = document.getElementById('filterGroup')?.value;
    const st = document.getElementById('filterStage')?.value;
    const dt = document.getElementById('filterDate')?.value;
    const tm = document.getElementById('filterTeam')?.value?.toLowerCase();
    const status = document.getElementById('filterStatus')?.value;

    if (g) list = list.filter(f => f.group === g);
    if (st) list = list.filter(f => f.stage === st);
    if (dt) list = list.filter(f => f.date.startsWith(dt));
    if (tm) list = list.filter(f => f.homeTeam.toLowerCase().includes(tm) || f.awayTeam.toLowerCase().includes(tm));
    if (status) list = list.filter(f => f.status === status);
    return list;
  }

  startCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      const el = document.getElementById('countdown');
      if (!el) return;
      const next = this.getNextMatch();
      if (!next) { el.textContent = '—'; return; }
      const diff = new Date(next.date) - Date.now();
      if (diff <= 0) { el.textContent = 'En juego'; return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = `${d}d ${h}h ${m}m ${s}s`;
    }, 1000);
  }

  animateKPI(id, endVal, suffix = '') {
    const el = document.getElementById(id);
    if (!el || typeof countUp === 'undefined') { if (el) el.textContent = endVal + suffix; return; }
    const opts = { duration: 1.2, suffix };
    if (typeof endVal === 'number' && !Number.isInteger(endVal)) opts.decimalPlaces = 1;
    new countUp.CountUp(id, endVal, opts).start();
  }

  renderDashboard() {
    const main = document.getElementById('mainContent');
    const next = this.getNextMatch();
    const todayVB = this.valueBets.filter(vb => {
      const today = new Date().toDateString();
      return new Date(vb.fixture.date).toDateString() === today;
    });
    const top3 = this.valueBets.slice(0, 3);
    const accuracy = this.modelHistory[this.modelHistory.length - 1]?.accuracy || 62;

    main.innerHTML = `
      <div class="demo-banner ${this.apiTrust.trusted ? 'hidden' : ''}" id="demoBanner">
        <span>⚽</span><span><strong>Modo Demo</strong> — Datos simulados realistas. Configura tus API keys en Configuración para datos en vivo.</span>
      </div>
      <h1 class="view-title"><i data-lucide="layout-dashboard"></i> Dashboard</h1>
      <div class="kpi-grid">
        <div class="kpi-card"><div class="label">Partidos disponibles</div><div class="value" id="kpiMatches">${this.fixtures.length}</div></div>
        <div class="kpi-card gold"><div class="label">Value Bets hoy</div><div class="value" id="kpiVBToday">${todayVB.length}</div></div>
        <div class="kpi-card"><div class="label">Precisión modelo</div><div class="value" id="kpiAccuracy">${accuracy}%</div></div>
        <div class="kpi-card"><div class="label">ROI acumulado (demo)</div><div class="value" id="kpiROI">+8.4%</div></div>
      </div>
      <div class="grid-2">
        <div class="card">
          <h3>Próximo Partido</h3>
          ${next ? `
            <div class="fixture-teams" style="margin-bottom:var(--space-4)">
              <div class="team-row"><img src="${flagUrl(next.homeTeam)}" alt="" loading="lazy" width="28" height="20"><strong>${escapeHtml(next.homeTeam)}</strong></div>
              <span class="vs">VS</span>
              <div class="team-row away"><img src="${flagUrl(next.awayTeam)}" alt="" loading="lazy" width="28" height="20"><strong>${escapeHtml(next.awayTeam)}</strong></div>
            </div>
            <p style="color:var(--color-text-muted);font-size:var(--text-sm)">${formatDate(next.date)} · ${formatTime(next.date)}</p>
            <p class="countdown" id="countdown">—</p>
            <button class="btn btn-primary btn-sm" style="margin-top:var(--space-4)" data-match="${next.id}">Ver Predicción</button>
          ` : '<p class="empty-state">No hay partidos próximos</p>'}
        </div>
        <div class="card">
          <h3>Top Value Bets</h3>
          <div class="value-list">
            ${top3.length ? top3.map(vb => `
              <div class="value-item ${vb.confidence === 'MEDIUM' ? 'med' : ''}">
                <div><strong>${escapeHtml(vb.fixture.homeTeam)} vs ${escapeHtml(vb.fixture.awayTeam)}</strong><br>
                <span style="font-size:var(--text-xs);color:var(--color-text-muted)">${escapeHtml(vb.market)} @ ${vb.odds.toFixed(2)}</span></div>
                <div style="text-align:right"><span class="tag ${vb.confidence === 'HIGH' ? 'high' : 'med'}">${evFmt(vb.expectedValue)} EV</span></div>
              </div>`).join('') : '<div class="empty-state" style="padding:var(--space-4)">No hay value bets detectadas</div>'}
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Rendimiento del Modelo</h3>
        <div class="chart-container"><canvas id="chart-performance"></canvas></div>
      </div>`;

    main.querySelector('[data-match]')?.addEventListener('click', e => this.openMatchModal(e.target.dataset.match));
    setTimeout(() => ChartManager.createPerformanceLine('chart-performance', this.modelHistory), 100);
    if (window.lucide) lucide.createIcons();
  }

  renderFixtures(mode = 'groups') {
    const main = document.getElementById('mainContent');
    const titles = { today: 'Partidos Hoy', groups: 'Fase de Grupos', knockout: 'Eliminatorias' };
    const groups = [...new Set(this.fixtures.map(f => f.group).filter(Boolean))].sort();
    const stages = [...new Set(this.fixtures.map(f => f.stage).filter(Boolean))];

    main.innerHTML = `
      <div class="demo-banner ${this.apiTrust.trusted ? 'hidden' : ''}"><span>⚽</span><span><strong>Modo Demo</strong> — Configura APIs para datos en vivo.</span></div>
      <h1 class="view-title"><i data-lucide="calendar"></i> ${titles[mode] || 'Partidos'}</h1>
      <div class="filters">
        <select id="filterGroup" aria-label="Filtrar por grupo"><option value="">Todos los grupos</option>
          ${groups.map(g => `<option value="${g}">Grupo ${g}</option>`).join('')}</select>
        <select id="filterStage" aria-label="Filtrar por fase"><option value="">Todas las fases</option>
          ${stages.map(s => `<option value="${s}">${STAGE_LABELS[s] || s}</option>`).join('')}</select>
        <input type="date" id="filterDate" aria-label="Filtrar por fecha">
        <input type="text" id="filterTeam" placeholder="Buscar equipo..." aria-label="Buscar equipo">
        <select id="filterStatus" aria-label="Filtrar por estado">
          <option value="">Todos</option><option value="scheduled">Programado</option><option value="finished">Finalizado</option>
        </select>
      </div>
      <div class="fixtures-grid" id="fixturesGrid"></div>`;

    const applyFilters = () => {
      const list = this.filterFixtures(mode);
      const grid = document.getElementById('fixturesGrid');
      if (!list.length) { this.showEmpty(grid, mode === 'today' ? 'No hay partidos hoy' : 'No hay partidos con estos filtros'); return; }
      grid.innerHTML = list.map(f => this.fixtureCardHTML(f)).join('');
      grid.querySelectorAll('[data-match]').forEach(btn => {
        btn.addEventListener('click', e => {
          const id = e.currentTarget.dataset.match;
          if (e.currentTarget.dataset.action === 'predict') this.openMatchModal(id);
        });
      });
    };

    ['filterGroup','filterStage','filterDate','filterTeam','filterStatus'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', applyFilters);
      document.getElementById(id)?.addEventListener('change', applyFilters);
    });
    if (mode === 'groups') document.getElementById('filterStage').value = 'group-stage';
    applyFilters();
    if (window.lucide) lucide.createIcons();
  }

  fixtureCardHTML(f) {
    const placeholder = isPlaceholderTeam(f.homeTeam) || isPlaceholderTeam(f.awayTeam);
    const pred = this.predictions[f.id];
    return `
      <article class="fixture-card">
        <div class="fixture-meta">${STAGE_LABELS[f.stage] || f.stage}${f.group ? ` · Grupo ${f.group}` : ''} · #${f.matchNumber}</div>
        <div class="fixture-teams">
          <div class="team-row">${placeholder ? '' : `<img src="${flagUrl(f.homeTeam)}" alt="" loading="lazy" width="28" height="20">`}
            <span>${escapeHtml(f.homeTeam)}</span></div>
          <span class="vs">VS</span>
          <div class="team-row away">${placeholder ? '' : `<img src="${flagUrl(f.awayTeam)}" alt="" loading="lazy" width="28" height="20">`}
            <span>${escapeHtml(f.awayTeam)}</span></div>
        </div>
        <div class="fixture-meta">${formatDate(f.date)} · ${formatTime(f.date)}</div>
        ${f.stadium ? `<div class="fixture-meta">${escapeHtml(f.stadium)}${f.city ? ', ' + escapeHtml(f.city) : ''}</div>` : ''}
        ${placeholder ? '<p style="color:var(--color-text-muted);font-size:var(--text-sm)">Pendiente de definir</p>' :
          pred ? `<div style="font-size:var(--text-xs);margin:var(--space-2) 0">Predicción: ${pct(pred.prediction.homeWin)} / ${pct(pred.prediction.draw)} / ${pct(pred.prediction.awayWin)}</div>
          <button class="btn btn-primary btn-sm" data-match="${f.id}" data-action="predict">Ver Predicción</button>` :
          '<button class="btn btn-secondary btn-sm" disabled>Sin datos</button>'}
      </article>`;
  }

  async openMatchModal(matchId) {
    const fixture = this.fixtures.find(f => f.id === matchId);
    if (!fixture) return;
    const modal = document.getElementById('matchModal');
    const body = document.getElementById('modalBody');
    document.getElementById('modalTitle').textContent = `${fixture.homeTeam} vs ${fixture.awayTeam}`;
    body.innerHTML = '<div class="skeleton" style="height:400px"></div>';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    let pred = this.predictions[matchId];
    if (!pred) {
      const data = await this.getMatchData(fixture);
      if (data) {
        pred = PredictionEngine.runFullPrediction(fixture, data, this.config);
        this.predictions[matchId] = pred;
      }
    }
    if (!pred) {
      body.innerHTML = '<div class="empty-state">No hay datos disponibles para este partido</div>';
      return;
    }
    this.renderMatchAnalysis(matchId, pred, fixture);
    if (window.lucide) lucide.createIcons();
  }

  closeMatchModal() {
    ChartManager.destroyAll();
    document.getElementById('matchModal').classList.remove('open');
    document.body.style.overflow = '';
  }

  renderMatchAnalysis(matchId, pred, fixture) {
    const body = document.getElementById('modalBody');
    const p = pred.prediction;
    const d = pred.data;
    const lm = d.lineMovement || {};
    const markets = [
      { label: fixture.homeTeam, prob: p.homeWin, odds: d.marketHomeOdds },
      { label: 'Empate', prob: p.draw, odds: d.marketDrawOdds },
      { label: fixture.awayTeam, prob: p.awayWin, odds: d.marketAwayOdds }
    ];

    body.innerHTML = `
      <p style="color:var(--color-text-muted);margin-bottom:var(--space-4)">${formatDate(fixture.date)} · ${escapeHtml(fixture.stadium || '')} ${fixture.city ? ', ' + escapeHtml(fixture.city) : ''}</p>
      <div class="analysis-grid">
        <div class="card" style="padding:var(--space-3)">
          <h3 style="font-size:var(--text-base)">Predicción del Modelo</h3>
          <div class="prob-table">
            ${markets.map(m => `<div class="prob-cell"><div style="font-size:var(--text-xs);color:var(--color-text-muted)">${escapeHtml(m.label)}</div><div class="pct">${pct(m.prob)}</div><div style="font-size:var(--text-xs)">@${m.odds?.toFixed(2)}</div></div>`).join('')}
          </div>
          <div class="chart-container" style="height:180px"><canvas id="chart-prob"></canvas></div>
        </div>
        <div class="card" style="padding:var(--space-3)">
          <h3 style="font-size:var(--text-base)">Cuotas de Mercado</h3>
          ${Object.entries(d.bookmakers || {}).map(([name, o]) => `
            <div style="font-size:var(--text-sm);margin-bottom:var(--space-2)"><strong>${escapeHtml(name)}:</strong> ${o.home?.toFixed(2)} / ${o.draw?.toFixed(2)} / ${o.away?.toFixed(2)}</div>`).join('')}
          <div class="oddsflow ${lm.direction === 'dropping' ? 'dropping' : ''}">
            <span>OddsFlow (sim):</span> ${lm.opening?.toFixed(2)} <span class="arrow">→</span> ${lm.current?.toFixed(2)}
            <span style="color:var(--color-text-muted)">(${lm.direction === 'dropping' ? 'bajando' : 'subiendo'})</span>
          </div>
        </div>
      </div>
      <div class="grid-2">
        <div class="card"><h3>Score Más Probable</h3>
          <p style="font-size:var(--text-xl);font-family:var(--font-display);color:var(--color-gold)">
            ${p.mostLikelyScore.home}-${p.mostLikelyScore.away} (${pct(p.mostLikelyScore.probability)})</p>
          <p style="color:var(--color-text-muted)">Goles esperados: ${(p.expectedHomeGoals + p.expectedAwayGoals).toFixed(1)}</p>
          <p style="font-size:var(--text-sm);margin-top:var(--space-2)">Top 5: ${p.top5Scores.map(s => `${s.home}-${s.away}`).join(', ')}</p>
        </div>
        <div class="card"><h3>Mapa de Resultados</h3><div id="heatmap-scores"></div></div>
      </div>
      <div class="grid-2">
        <div class="card"><h3>Distribución de Goles</h3><div class="chart-container"><canvas id="chart-goals"></canvas></div></div>
        <div class="card"><h3>Comparativa xG</h3><div class="chart-container"><canvas id="chart-xg"></canvas></div></div>
      </div>
      <div class="card">
        <h3>Value Bets Detectadas</h3>
        ${pred.valueBets.length ? pred.valueBets.map(vb => `
          <div class="value-item ${vb.confidence === 'MEDIUM' ? 'med' : ''}" style="margin-bottom:var(--space-2)">
            <div>${vb.recommendation} <strong>${escapeHtml(vb.market)}</strong><br>
            <span style="font-size:var(--text-xs)">EV: ${evFmt(vb.expectedValue)} | Edge: ${evFmt(vb.edge)} | Kelly 1/4: ${pct(vb.kelly.recommendedBet)} del bankroll (${euro(vb.kelly.stakeSuggestion)})</span></div>
            <span class="tag ${vb.confidence === 'HIGH' ? 'high' : 'med'}">${vb.confidence}</span>
          </div>`).join('') : '<p class="empty-state" style="padding:var(--space-4)">Sin value bets para este partido</p>'}
      </div>
      <div class="card">
        <h3>Estadísticas Comparativas</h3>
        <div class="stats-bars">
          <div class="stat-row"><span style="width:80px">${escapeHtml(fixture.homeTeam)}</span><div class="form-badges">${formBar(d.homeForm)}</div></div>
          <div class="stat-row"><span style="width:80px">${escapeHtml(fixture.awayTeam)}</span><div class="form-badges">${formBar(d.awayForm)}</div></div>
          <div class="stat-row"><span style="width:120px">xG For</span><span>${escapeHtml(fixture.homeTeam.slice(0,3).toUpperCase())} ${d.homeXGFor.toFixed(2)}</span><div class="stat-bar"><div class="stat-bar-fill" style="width:${Math.min(d.homeXGFor/3*100,100)}%"></div></div><span>${d.awayXGFor.toFixed(2)} ${escapeHtml(fixture.awayTeam.slice(0,3).toUpperCase())}</span></div>
          <div class="stat-row"><span style="width:120px">Ranking FIFA</span><span>#${d.homeRanking}</span><span style="flex:1;text-align:center;color:var(--color-text-muted)">●──────────</span><span>#${d.awayRanking}</span></div>
          <div class="stat-row"><span style="width:120px">H2H (5)</span><span>${d.h2hHomeWins}W - ${d.h2hDraws}D - ${d.h2hAwayWins}L</span></div>
        </div>
      </div>
      <div class="card">
        <h3>Configurar Apuesta</h3>
        <div class="bet-calc">
          <div class="form-group"><label>Bankroll (€)</label><input type="number" id="betBankroll" value="${this.config.bankroll}" min="1"></div>
          <div class="form-group"><label>Mercado</label>
            <select id="betMarket">
              <option value="home">${escapeHtml(fixture.homeTeam)} gana (${d.marketHomeOdds?.toFixed(2)})</option>
              <option value="draw">Empate (${d.marketDrawOdds?.toFixed(2)})</option>
              <option value="away">${escapeHtml(fixture.awayTeam)} gana (${d.marketAwayOdds?.toFixed(2)})</option>
              <option value="over25">Over 2.5 (${d.over25Odds?.toFixed(2)})</option>
            </select>
          </div>
          <div class="form-group"><label>Cuota</label><input type="number" id="betOdds" value="${d.marketHomeOdds?.toFixed(2)}" step="0.01" min="1.01"></div>
        </div>
        <div class="bet-result" id="betResult"></div>
      </div>`;

    const updateBet = () => {
      const market = document.getElementById('betMarket').value;
      const oddsMap = { home: d.marketHomeOdds, draw: d.marketDrawOdds, away: d.marketAwayOdds, over25: d.over25Odds };
      const probMap = { home: p.homeWin, draw: p.draw, away: p.awayWin, over25: pred.over25Prob };
      const odds = parseFloat(document.getElementById('betOdds').value) || oddsMap[market];
      const prob = probMap[market];
      const bankroll = parseFloat(document.getElementById('betBankroll').value) || this.config.bankroll;
      const kelly = PredictionEngine.kellyCriterion(prob, odds, bankroll, this.config.kellyFraction);
      const profit = kelly.stakeSuggestion * (odds - 1);
      document.getElementById('betResult').innerHTML = `Apostar: <strong>${euro(kelly.stakeSuggestion)}</strong> (${pct(kelly.recommendedBet)} bankroll) · Ganancia potencial: <strong>+${euro(profit)}</strong> · Riesgo: ${kelly.riskLevel}`;
    };

    document.getElementById('betMarket').addEventListener('change', e => {
      const m = e.target.value;
      const oddsMap = { home: d.marketHomeOdds, draw: d.marketDrawOdds, away: d.marketAwayOdds, over25: d.over25Odds };
      document.getElementById('betOdds').value = oddsMap[m]?.toFixed(2);
      updateBet();
    });
    document.getElementById('betBankroll').addEventListener('input', updateBet);
    document.getElementById('betOdds').addEventListener('input', updateBet);
    updateBet();

    setTimeout(() => {
      ChartManager.createProbDoughnut('chart-prob', [p.homeWin, p.draw, p.awayWin], [fixture.homeTeam, 'Empate', fixture.awayTeam]);
      ChartManager.createGoalsBar('chart-goals', pred.adjusted.adjustedHomeLambda, pred.adjusted.adjustedAwayLambda);
      ChartManager.createXGBar('chart-xg', d, fixture.homeTeam, fixture.awayTeam);
      ChartManager.renderHeatmap('heatmap-scores', p.scoreProbabilities);
    }, 150);
  }

  renderValueBets() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <h1 class="view-title"><i data-lucide="trending-up"></i> Value Bets</h1>
      <div class="filters">
        <label>EV mínimo: <input type="number" id="vbMinEV" value="0" step="0.01" min="0" style="width:80px"></label>
        <select id="vbConfidence" aria-label="Confianza"><option value="">Todas</option><option value="HIGH">HIGH</option><option value="MEDIUM">MEDIUM</option></select>
        <select id="vbStage" aria-label="Fase"><option value="">Todas las fases</option>
          ${Object.entries(STAGE_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <button class="btn btn-primary" id="exportCSV"><i data-lucide="download"></i> Exportar CSV</button>
      </div>
      <div class="table-wrap"><table><thead><tr>
        <th>Partido</th><th>Mercado</th><th>Cuota</th><th>Prob. Modelo</th><th>Edge</th><th>EV</th><th>Kelly</th><th>Acción</th>
      </tr></thead><tbody id="vbTableBody"></tbody></table></div>`;

    const renderTable = () => {
      const minEV = parseFloat(document.getElementById('vbMinEV').value) || 0;
      const conf = document.getElementById('vbConfidence').value;
      const stage = document.getElementById('vbStage').value;
      let list = this.valueBets.filter(vb => vb.expectedValue >= minEV);
      if (conf) list = list.filter(vb => vb.confidence === conf);
      if (stage) list = list.filter(vb => vb.fixture.stage === stage);
      const tbody = document.getElementById('vbTableBody');
      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No hay value bets con estos filtros ⚽</div></td></tr>`;
        return;
      }
      tbody.innerHTML = list.map(vb => `
        <tr>
          <td>${escapeHtml(vb.fixture.homeTeam)} vs ${escapeHtml(vb.fixture.awayTeam)}</td>
          <td>${escapeHtml(vb.market)}</td>
          <td>${vb.odds?.toFixed(2)}</td>
          <td>${pct(vb.prob)}</td>
          <td style="color:var(--color-value-high)">${evFmt(vb.edge)}</td>
          <td style="color:var(--color-value-high)">${evFmt(vb.expectedValue)}</td>
          <td>${pct(vb.kelly.recommendedBet)} (${euro(vb.kelly.stakeSuggestion)})</td>
          <td><button class="btn btn-sm btn-secondary" data-match="${vb.matchId}">Ver</button></td>
        </tr>`).join('');
      tbody.querySelectorAll('[data-match]').forEach(btn => btn.addEventListener('click', e => this.openMatchModal(e.target.dataset.match)));
    };

    ['vbMinEV','vbConfidence','vbStage'].forEach(id => {
      document.getElementById(id).addEventListener('input', renderTable);
      document.getElementById(id).addEventListener('change', renderTable);
    });
    document.getElementById('exportCSV').addEventListener('click', () => this.exportCSV());
    renderTable();
    if (window.lucide) lucide.createIcons();
  }

  exportCSV() {
    const minEV = parseFloat(document.getElementById('vbMinEV')?.value) || 0;
    const rows = [['Partido','Mercado','Cuota','ProbModelo','Edge','EV','KellyPct','Stake']];
    this.valueBets.filter(vb => vb.expectedValue >= minEV).forEach(vb => {
      rows.push([
        `${vb.fixture.homeTeam} vs ${vb.fixture.awayTeam}`,
        vb.market, vb.odds?.toFixed(2), pct(vb.prob), evFmt(vb.edge), evFmt(vb.expectedValue),
        pct(vb.kelly.recommendedBet), euro(vb.kelly.stakeSuggestion)
      ]);
    });
    const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `worldbet-value-bets-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  }

  renderAIAnalysis() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <h1 class="view-title"><i data-lucide="brain"></i> Análisis IA</h1>
      <div class="disclaimer">Análisis generado por el motor estadístico local (Poisson + xG + EV). No constituye asesoramiento financiero.</div>
      <div class="ai-chat" style="margin-top:var(--space-4)">
        <div class="ai-messages" id="aiMessages">
          <div class="ai-msg bot">Hola, soy el motor de WorldBet AI. Pregúntame sobre partidos, value bets, goles esperados, forma o H2H. Ejemplo: "¿Hay value bet en Brasil vs Marruecos?"</div>
        </div>
        <div class="ai-input-row">
          <textarea id="aiInput" placeholder="Escribe tu pregunta sobre un partido..." aria-label="Pregunta"></textarea>
          <button class="btn btn-primary" id="aiSend" aria-label="Enviar">Enviar</button>
        </div>
      </div>`;

    const send = () => {
      const input = document.getElementById('aiInput');
      const q = input.value.trim();
      if (!q) return;
      const msgs = document.getElementById('aiMessages');
      msgs.innerHTML += `<div class="ai-msg user">${escapeHtml(q)}</div>`;
      const answer = this.processAIQuery(q);
      msgs.innerHTML += `<div class="ai-msg bot">${answer}</div>`;
      this.aiHistory.push({ q, answer, ts: new Date() });
      input.value = '';
      msgs.scrollTop = msgs.scrollHeight;
    };
    document.getElementById('aiSend').addEventListener('click', send);
    document.getElementById('aiInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    if (window.lucide) lucide.createIcons();
  }

  processAIQuery(query) {
    const q = query.toLowerCase();
    let fixture = null;
    for (const f of this.fixtures) {
      if (isPlaceholderTeam(f.homeTeam)) continue;
      if (q.includes(f.homeTeam.toLowerCase()) || q.includes(f.awayTeam.toLowerCase())) { fixture = f; break; }
    }
    if (!fixture) fixture = this.fixtures.find(f => !isPlaceholderTeam(f.homeTeam) && this.predictions[f.id]);

    if (!fixture || !this.predictions[fixture.id]) {
      return 'No encontré un partido relevante. Menciona equipos como Brasil, Argentina o Francia.';
    }

    const pred = this.predictions[fixture.id];
    const p = pred.prediction;
    const d = pred.data;

    if (/value|ev|apost/i.test(q)) {
      if (!pred.valueBets.length) return `Para <strong>${fixture.homeTeam} vs ${fixture.awayTeam}</strong>, el modelo no detecta value bets con edge &gt; ${pct(this.config.minEdge)}.`;
      return pred.valueBets.map(vb =>
        `<strong>${vb.market}</strong>: EV ${evFmt(vb.expectedValue)}, edge ${evFmt(vb.edge)}. ${vb.recommendation} Kelly: ${euro(vb.kelly.stakeSuggestion)}.`
      ).join('<br>');
    }
    if (/gol|score|marcador|over|under/i.test(q)) {
      return `<strong>${fixture.homeTeam} vs ${fixture.awayTeam}</strong>: Marcador más probable <strong>${p.mostLikelyScore.home}-${p.mostLikelyScore.away}</strong> (${pct(p.mostLikelyScore.probability)}). Goles esperados: ${(p.expectedHomeGoals + p.expectedAwayGoals).toFixed(1)}. Over 2.5: ${pct(pred.over25Prob)}.`;
    }
    if (/forma|rendimiento/i.test(q)) {
      return `<strong>${fixture.homeTeam}</strong>: ${d.homeForm.join('')} (últimos 5). <strong>${fixture.awayTeam}</strong>: ${d.awayForm.join('')}.`;
    }
    if (/h2h|historial|enfrent/i.test(q)) {
      return `H2H <strong>${fixture.homeTeam} vs ${fixture.awayTeam}</strong>: ${d.h2hHomeWins}W-${d.h2hDraws}D-${d.h2hAwayWins}L en últimos 5. Promedio goles: ${d.h2hAvgGoals.toFixed(1)}.`;
    }
    if (/cuota|odd/i.test(q)) {
      return `Cuotas mercado: ${fixture.homeTeam} ${d.marketHomeOdds?.toFixed(2)} | Empate ${d.marketDrawOdds?.toFixed(2)} | ${fixture.awayTeam} ${d.marketAwayOdds?.toFixed(2)}.`;
    }
    return `<strong>${fixture.homeTeam} vs ${fixture.awayTeam}</strong> (${formatDate(fixture.date)}): Probabilidades — ${fixture.homeTeam} ${pct(p.homeWin)}, Empate ${pct(p.draw)}, ${fixture.awayTeam} ${pct(p.awayWin)}. ${pred.valueBets.length ? `Mejor value: ${pred.valueBets[0].market} (EV ${evFmt(pred.valueBets[0].expectedValue)}).` : 'Sin value bets destacadas.'}`;
  }

  renderSettings() {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <h1 class="view-title"><i data-lucide="settings"></i> Configuración</h1>
      <form class="settings-form" id="settingsForm">
        <div class="form-group"><label for="thestatsKey">TheStatsAPI Key</label>
          <input type="password" id="thestatsKey" value="${escapeHtml(this.config.thestatsapiKey)}" autocomplete="off"></div>
        <div class="form-group"><label for="worldcupKey">WorldCupAPI Key</label>
          <input type="password" id="worldcupKey" value="${escapeHtml(this.config.worldcupApiKey)}" autocomplete="off"></div>
        <div class="form-group"><label for="oddsKey">The Odds API Key</label>
          <input type="password" id="oddsKey" value="${escapeHtml(this.config.oddsApiKey)}" autocomplete="off"></div>
        <div class="form-group"><label for="apifootballKey">API-Football Key (RapidAPI)</label>
          <input type="password" id="apifootballKey" value="${escapeHtml(this.config.apifootballKey)}" autocomplete="off"></div>
        <div class="form-group"><label for="corsProxy">CORS Proxy (opcional)</label>
          <input type="url" id="corsProxy" value="${escapeHtml(this.config.corsProxy)}" placeholder="https://corsproxy.io/?url="></div>
        <div class="form-group"><label for="bankrollInput">Bankroll (€)</label>
          <input type="number" id="bankrollInput" value="${this.config.bankroll}" min="1"></div>
        <div class="form-group"><label for="kellyInput">Kelly Fraction (0.25 = 25%)</label>
          <input type="number" id="kellyInput" value="${this.config.kellyFraction}" step="0.05" min="0.05" max="1"></div>
        <div class="form-group"><label for="minEdgeInput">Edge mínimo value bet (%)</label>
          <input type="number" id="minEdgeInput" value="${this.config.minEdge * 100}" step="1" min="1" max="20"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" id="saveSettings">Guardar</button>
          <button type="button" class="btn btn-secondary" id="testApis">Probar APIs</button>
          <button type="button" class="btn btn-secondary" id="resetSettings">Reset</button>
        </div>
        <div id="apiTestResults" style="margin-top:var(--space-4)"></div>
      </form>`;

    document.getElementById('saveSettings').addEventListener('click', () => this.saveSettings());
    document.getElementById('testApis').addEventListener('click', () => this.testApis());
    document.getElementById('resetSettings').addEventListener('click', () => this.resetSettings());
    if (window.lucide) lucide.createIcons();
  }

  async saveSettings() {
    this.config.thestatsapiKey = document.getElementById('thestatsKey').value.trim();
    this.config.worldcupApiKey = document.getElementById('worldcupKey').value.trim();
    this.config.oddsApiKey = document.getElementById('oddsKey').value.trim();
    this.config.apifootballKey = document.getElementById('apifootballKey').value.trim();
    this.config.corsProxy = document.getElementById('corsProxy').value.trim();
    this.config.bankroll = parseFloat(document.getElementById('bankrollInput').value) || 1000;
    this.config.kellyFraction = parseFloat(document.getElementById('kellyInput').value) || 0.25;
    this.config.minEdge = (parseFloat(document.getElementById('minEdgeInput').value) || 5) / 100;
    this.api = new ApiClient(this.config);
    this.matchDataCache = {};
    this.oddsEventsCache = null;
    await this.computeAllPredictions();
    document.getElementById('bankrollBadge').textContent = euro(this.config.bankroll);
    if (this.hasLiveKeys()) {
      await this.runApiValidation();
      this.renderApiTestResults();
    } else {
      this.apiTrust = { tested: false, testing: false, trusted: false, validCount: 0, validSources: [], results: {} };
      this.updateTrustBadge();
    }
    alert(this.apiTrust.trusted ? 'APIs verificadas — modo LIVE activo' : 'Configuración guardada en memoria de sesión.');
  }

  renderApiTestResults() {
    const el = document.getElementById('apiTestResults');
    if (!el || !this.apiTrust.tested) return;
    const labels = this.apiTrustLabels();
    const rows = Object.entries(this.apiTrust.results).map(([key, r]) => {
      const color = r.ok ? 'var(--color-gold)' : r.skipped ? 'var(--color-text-muted)' : 'var(--color-error)';
      const status = r.ok ? 'Verificada' : r.skipped ? 'No configurada' : 'Fallida';
      return `<p><strong>${labels[key]}:</strong> <span style="color:${color}">${escapeHtml(r.msg)}</span> (${status})</p>`;
    }).join('');
    el.innerHTML = `<div class="card"><h3>Resultados de prueba</h3>${rows}
      ${this.apiTrust.trusted
        ? `<p style="color:var(--color-gold);font-weight:600;margin-top:var(--space-3)">✓ ${this.apiTrust.validCount} API(s) verificada(s) — círculo dorado en el header.</p>`
        : `<p style="color:var(--color-error);margin-top:var(--space-3)">Ninguna API verificada. Datos simulados.</p>`}
      ${!this.config.corsProxy ? '<p style="color:var(--color-warning);font-size:var(--text-sm)">Tip: Configura un CORS proxy si las APIs fallan por CORS.</p>' : ''}
    </div>`;
  }

  async testApis() {
    const el = document.getElementById('apiTestResults');
    el.innerHTML = '<div class="skeleton" style="height:80px"></div>';
    await this.saveSettings();
    this.renderApiTestResults();
  }

  resetSettings() {
    this.config = { thestatsapiKey:'', worldcupApiKey:'', oddsApiKey:'', apifootballKey:'', corsProxy:'', bankroll:1000, kellyFraction:0.25, minEdge:0.05, leagueAvgGoals:1.35 };
    this.api = new ApiClient(this.config);
    this.matchDataCache = {};
    this.oddsEventsCache = null;
    this.apiTrust = { tested: false, testing: false, trusted: false, validCount: 0, validSources: [], results: {} };
    this.computeAllPredictions().then(() => { this.renderSettings(); this.updateApiStatusBar(); this.updateTrustBadge(); });
  }

  updateApiStatusBar() {
    const pills = document.getElementById('apiPills');
    const items = [
      { key: 'fixtures', label: 'Fixtures' },
      { key: 'thestats', label: 'Stats' },
      { key: 'odds', label: 'Odds' },
      { key: 'apifootball', label: 'Football' }
    ];
    pills.innerHTML = items.map(({ key, label }) => {
      const s = this.apiStatus[key] || 'idle';
      const cls = s === 'ok' ? 'ok' : s === 'warn' ? 'warn' : s === 'err' ? 'err' : '';
      return `<span class="api-pill ${cls}"><span class="dot"></span>${label}</span>`;
    }).join('');
  }

  updateStatusBar() {
    const left = document.getElementById('statusLeft');
    const mode = this.apiTrust.trusted ? 'LIVE VERIFICADO' : 'Demo';
    left.textContent = `Última actualización: ${this.lastUpdate ? this.lastUpdate.toLocaleTimeString('es-ES') : '—'} · Modo ${mode} · ${this.fixtures.length} partidos`;
  }
}

// ========== BOOT ==========
const app = new WorldBetAI();
document.addEventListener('DOMContentLoaded', () => app.init());
