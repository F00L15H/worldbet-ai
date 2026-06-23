// ========== WORLDBET AI MAIN CLASS ==========
/** Config por defecto — API keys vía variables de entorno en build o Configuración */
const DEFAULT_CONFIG = {
  thestatsapiKey: (typeof window !== 'undefined' && window.API_KEYS?.thestatsapi) || '',
  worldcupApiKey: (typeof window !== 'undefined' && window.API_KEYS?.worldcup) || '',
  oddsApiKey: (typeof window !== 'undefined' && window.API_KEYS?.odds) || '',
  apifootballKey: (typeof window !== 'undefined' && window.API_KEYS?.apifootball) || '',
  corsProxy: 'https://corsproxy.io/?',
  bankroll: 10000,
  kellyFraction: 0.25,
  minEdge: 0.05,
  leagueAvgGoals: 1.35,
  predictionWindowDays: 7
};

class WorldBetAI {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.fixtures = [];
    this.predictions = {};
    this.odds = {};
    this.valueBets = [];
    this.modelHistory = [];
    this.modelAccuracy = { hasData: false, hitRate: 0, sampleSize: 0, history: [] };
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
    this.auth = new AuthManager(this);
    this.bets = new BetsManager(this);
    this.oddsLive = new OddsLiveManager(this);
    this.authModalOpen = false;
    this.betFilter = '';
  }

  hasConfiguredKeys() {
    return !!(this.config.thestatsapiKey || this.config.apifootballKey || this.config.worldcupApiKey);
  }

  apiTrustLabels() {
    return {
      thestats: 'TheStatsAPI',
      worldcup: 'WorldCupAPI',
      apifootball: 'API-Football',
      odds: 'Cuotas live (servidor)'
    };
  }

  async runApiValidation() {
    this.apiTrust.testing = true;
    this.updateApiStatus();

    const labels = this.apiTrustLabels();
    const entries = [
      ['thestats', !!this.config.thestatsapiKey, () => this.apiClient.testTheStatsApi()],
      ['worldcup', !!this.config.worldcupApiKey, () => this.apiClient.testWorldCupApi()],
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

  loadSessionPrefs() {}

  saveSessionPrefs() {}

  async init() {
    this.loadSessionPrefs();
    this.bindEvents();
    this.updateBankrollDisplay();
    if (SupabaseClient.isConfigured()) {
      await this.auth.init();
      this.updateAuthHeader();
    }
    await this.loadAllFixtures();
    if (SupabaseClient.isConfigured()) {
      await this.bets.syncMatchesFromServer().catch(() => {});
      await this.bets.upsertMatches(this.fixtures).catch(() => {});
      const dbMatches = await this.bets.loadDbMatches();
      this.fixtures = this.bets.mergeDbStatusIntoFixtures(this.fixtures, dbMatches);
      if (this.auth.isLoggedIn) await this.bets.loadUserBets();
      await this.oddsLive.init();
      await this.refreshModelAccuracy();
    }
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
    this.registerServiceWorker();
    this.showIosInstallBanner();
  }

  registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  showIosInstallBanner() {
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    try { if (localStorage.getItem('wb_install_dismissed')) return; } catch {}
    const ua = navigator.userAgent || '';
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    if (!isIos || !isSafari) return;
    const root = document.getElementById('install-banner-root');
    if (!root) return;
    root.innerHTML = `
      <div class="install-banner" id="install-banner" role="dialog" aria-label="Instalar app">
        <strong>Instalar en iPhone</strong>
        <p style="margin:var(--space-2) 0;font-size:var(--text-xs);color:var(--color-text-muted)">
          Pulsa <strong>Compartir</strong> en Safari y elige <strong>Añadir a pantalla de inicio</strong>.
        </p>
        <button type="button" class="btn btn-outline btn-sm" id="btn-dismiss-install">Entendido</button>
      </div>`;
    document.getElementById('btn-dismiss-install')?.addEventListener('click', () => {
      try { localStorage.setItem('wb_install_dismissed', '1'); } catch {}
      root.innerHTML = '';
    });
  }

  onAuthChange() {
    this.updateAuthHeader();
    this.updateBankrollDisplay();
    if (this.auth.isLoggedIn) {
      this.bets.loadUserBets().then(() => {
        this.computeAllPredictions().then(() => this.render());
      });
    } else {
      this.bets.userBets = [];
      this.render();
    }
  }

  updateAuthHeader() {
    const el = document.getElementById('auth-header');
    if (!el) return;
    if (!SupabaseClient.isConfigured()) {
      el.innerHTML = '<span style="font-size:var(--text-xs);color:var(--color-text-muted)">Sin backend</span>';
      return;
    }
    if (this.auth.isLoggedIn) {
      el.innerHTML = `
        <span class="auth-display-name" style="font-size:var(--text-sm)">${escapeHtml(this.auth.displayName())}</span>
        <button class="btn btn-outline btn-sm" id="btn-auth-action" type="button">Salir</button>`;
      document.getElementById('btn-auth-action')?.addEventListener('click', () => this.auth.signOut());
    } else {
      el.innerHTML = `<button class="btn btn-outline btn-sm" id="btn-auth-action" type="button">Entrar</button>`;
      document.getElementById('btn-auth-action')?.addEventListener('click', () => this.openAuthModal());
    }
    lucide.createIcons();
  }

  getBankroll() {
    if (this.auth.isLoggedIn && this.auth.profile?.bankroll != null) {
      return parseFloat(this.auth.profile.bankroll) || 10000;
    }
    return parseFloat(this.config.bankroll) || 10000;
  }

  updateBankrollDisplay() {
    const amount = this.getBankroll();
    this.config.bankroll = amount;
    const el = document.getElementById('bankroll-quick');
    if (el) el.textContent = euro(amount);
    const cfg = document.getElementById('cfg-bankroll-display');
    if (cfg) cfg.textContent = euro(amount);
    const modalBr = document.getElementById('bet-bankroll');
    if (modalBr) modalBr.textContent = euro(amount);
  }

  renderAuthSettingsCard() {
    if (!SupabaseClient.isConfigured()) {
      return `<div class="card"><p style="color:var(--color-text-muted);font-size:var(--text-sm)">Backend no configurado — no hay inicio de sesión disponible.</p></div>`;
    }
    if (this.auth.isLoggedIn) {
      return `<div class="card" id="settings-auth-card">
        <h2 class="card-title">Tu cuenta</h2>
        <p style="margin-bottom:var(--space-2)"><strong>${escapeHtml(this.auth.displayName())}</strong></p>
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3)">
          Bankroll virtual: <span class="rec-odds-big" id="cfg-bankroll-display">${euro(this.getBankroll())}</span>
          <br><small>Solo cambia al ganar o perder apuestas.</small>
        </p>
        <button type="button" class="btn btn-outline" id="btn-profile-logout">Cerrar sesión</button>
      </div>`;
    }
    return `<div class="card" id="settings-auth-card">
      <h2 class="card-title">Acceder</h2>
      <p style="color:var(--color-text-muted);font-size:var(--text-sm);margin-bottom:var(--space-4)">Inicia sesión o crea una cuenta para guardar apuestas con bankroll virtual.</p>
      <div class="auth-tabs">
        <button type="button" class="auth-tab active" data-settings-auth-tab="login">Iniciar sesión</button>
        <button type="button" class="auth-tab" data-settings-auth-tab="register">Registrarse</button>
      </div>
      <div id="settings-auth-login">
        <div class="form-group"><label>Email</label><input type="email" id="settings-auth-email" autocomplete="email"></div>
        <div class="form-group"><label>Contraseña</label><input type="password" id="settings-auth-password" autocomplete="current-password"></div>
        <button type="button" class="btn btn-primary" id="btn-settings-login" style="width:100%">Entrar</button>
      </div>
      <div id="settings-auth-register" style="display:none">
        <div class="form-group"><label>Nombre</label><input type="text" id="settings-auth-name" autocomplete="name"></div>
        <div class="form-group"><label>Email</label><input type="email" id="settings-auth-email-reg" autocomplete="email"></div>
        <div class="form-group"><label>Contraseña</label><input type="password" id="settings-auth-password-reg" autocomplete="new-password" minlength="6"></div>
        <button type="button" class="btn btn-primary" id="btn-settings-register" style="width:100%">Crear cuenta</button>
      </div>
      <p id="settings-auth-error" style="margin-top:var(--space-3);font-size:var(--text-sm)"></p>
    </div>`;
  }

  bindSettingsAuthEvents() {
    if (this.currentView !== 'settings') return;
    document.querySelectorAll('[data-settings-auth-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('[data-settings-auth-tab]').forEach(t => t.classList.toggle('active', t === tab));
        const isLogin = tab.dataset.settingsAuthTab === 'login';
        document.getElementById('settings-auth-login').style.display = isLogin ? 'block' : 'none';
        document.getElementById('settings-auth-register').style.display = isLogin ? 'none' : 'block';
      });
    });
    document.getElementById('btn-settings-login')?.addEventListener('click', async () => {
      const err = document.getElementById('settings-auth-error');
      try {
        await this.auth.signIn(
          document.getElementById('settings-auth-email').value.trim(),
          document.getElementById('settings-auth-password').value
        );
        err.style.color = 'var(--color-success)';
        err.textContent = 'Sesión iniciada.';
        this.render();
      } catch (e) { err.style.color = 'var(--color-error)'; err.textContent = e.message; }
    });
    document.getElementById('btn-settings-register')?.addEventListener('click', async () => {
      const err = document.getElementById('settings-auth-error');
      try {
        await this.auth.signUp(
          document.getElementById('settings-auth-email-reg').value.trim(),
          document.getElementById('settings-auth-password-reg').value,
          document.getElementById('settings-auth-name').value.trim()
        );
        err.style.color = 'var(--color-success)';
        err.textContent = 'Cuenta creada. Revisa tu email o inicia sesión.';
      } catch (e) { err.style.color = 'var(--color-error)'; err.textContent = e.message; }
    });
    document.getElementById('btn-profile-logout')?.addEventListener('click', () => this.auth.signOut());
  }

  openAuthModal() {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay" role="dialog" aria-modal="true">
        <div class="modal" style="max-width:420px">
          <div class="modal-header">
            <h2>Acceder a WorldBet</h2>
            <button class="icon-btn" id="modal-close" aria-label="Cerrar"><i data-lucide="x"></i></button>
          </div>
          <div class="modal-body">
            <div class="auth-tabs">
              <button class="auth-tab active" data-auth-tab="login" type="button">Iniciar sesión</button>
              <button class="auth-tab" data-auth-tab="register" type="button">Registrarse</button>
            </div>
            <div id="auth-panel-login">
              <div class="form-group"><label>Email</label><input type="email" id="auth-email" autocomplete="email"></div>
              <div class="form-group"><label>Contraseña</label><input type="password" id="auth-password" autocomplete="current-password"></div>
              <button class="btn btn-primary" id="btn-auth-login" type="button" style="width:100%">Entrar</button>
            </div>
            <div id="auth-panel-register" style="display:none">
              <div class="form-group"><label>Nombre</label><input type="text" id="auth-name" autocomplete="name"></div>
              <div class="form-group"><label>Email</label><input type="email" id="auth-reg-email" autocomplete="email"></div>
              <div class="form-group"><label>Contraseña</label><input type="password" id="auth-reg-password" autocomplete="new-password" minlength="6"></div>
              <button class="btn btn-primary" id="btn-auth-register" type="button" style="width:100%">Crear cuenta</button>
              <p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:var(--space-3)">Bankroll inicial: €10.000 virtual</p>
            </div>
            <p id="auth-error" style="color:var(--color-error);margin-top:var(--space-3);font-size:var(--text-sm)"></p>
          </div>
        </div>
      </div>`;
    lucide.createIcons();
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') this.closeModal();
    });
    document.querySelectorAll('[data-auth-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === btn));
        document.getElementById('auth-panel-login').style.display = btn.dataset.authTab === 'login' ? '' : 'none';
        document.getElementById('auth-panel-register').style.display = btn.dataset.authTab === 'register' ? '' : 'none';
      });
    });
    document.getElementById('btn-auth-login').addEventListener('click', async () => {
      const err = document.getElementById('auth-error');
      try {
        await this.auth.signIn(
          document.getElementById('auth-email').value.trim(),
          document.getElementById('auth-password').value
        );
        this.closeModal();
        this.showToast('Sesión iniciada');
        this.onAuthChange();
      } catch (e) { err.textContent = e.message; }
    });
    document.getElementById('btn-auth-register').addEventListener('click', async () => {
      const err = document.getElementById('auth-error');
      try {
        await this.auth.signUp(
          document.getElementById('auth-reg-email').value.trim(),
          document.getElementById('auth-reg-password').value,
          document.getElementById('auth-name').value.trim()
        );
        err.style.color = 'var(--color-success)';
        err.textContent = 'Cuenta creada. Revisa tu email para confirmar o inicia sesión.';
      } catch (e) { err.style.color = 'var(--color-error)'; err.textContent = e.message; }
    });
    this._lockScroll();
  }

  bindEvents() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.view));
    });
    document.querySelectorAll('[data-bottom-nav]').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.view));
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

  normalizeFixture(f) {
    const isPlaceholder = isPlaceholderTeam(f.homeTeam) || isPlaceholderTeam(f.awayTeam);
    const kickoffUtc = f.kickoffUtc || f.date;
    let status = 'scheduled';
    const rawStatus = (f.status || '').toLowerCase();
    if (['finished', 'ft', 'complete'].includes(rawStatus)) status = 'finished';
    else if (['live', 'inplay', '1h', '2h'].includes(rawStatus)) status = 'live';
    else if (f.homeScore != null && f.awayScore != null) status = 'finished';

    return {
      id: `wc-${String(f.matchNumber).padStart(3, '0')}`,
      matchNumber: f.matchNumber,
      homeTeam: f.homeTeam, awayTeam: f.awayTeam,
      stage: f.stage, group: f.group,
      kickoffUtc, date: f.date || kickoffUtc?.slice(0, 10),
      stadium: f.stadium, hostCity: f.hostCity,
      isPlaceholder, status,
      homeScore: f.homeScore ?? f.home_score ?? null,
      awayScore: f.awayScore ?? f.away_score ?? null
    };
  }

  getFixturesForPrediction() {
    const now = Date.now();
    const windowMs = (this.config.predictionWindowDays || 7) * 24 * 60 * 60 * 1000;
    const betMatchIds = new Set(this.bets.getUserBetMatchIds());
    return this.fixtures.filter(f => {
      if (f.isPlaceholder) return false;
      const kick = new Date(f.kickoffUtc).getTime();
      const inWindow = kick > now - 24 * 60 * 60 * 1000 && kick < now + windowMs;
      const hasBet = betMatchIds.has(f.id);
      const isRecent = kick > now - 14 * 24 * 60 * 60 * 1000 && kick <= now;
      return inWindow || hasBet || isRecent;
    });
  }

  async ensurePrediction(matchId) {
    if (this.predictions[matchId]) return this.predictions[matchId];
    const f = this.fixtures.find(x => x.id === matchId);
    if (!f || f.isPlaceholder) return null;
    const data = await this.getMatchData(f);
    if (!data) return null;
    const pred = PredictionEngine.runFullPrediction(f, data, this.config);
    this.predictions[f.id] = pred;
    await this.persistSnapshot(f.id, pred);
    this.rebuildValueBets();
    return pred;
  }

  async persistSnapshot(matchId, pred) {
    if (!SupabaseClient.isConfigured() || !pred?.recommendation) return null;
    return this.bets.saveSnapshot(
      matchId,
      pred.recommendation,
      pred.recommendation.dataSources || pred.data?.dataSources
    );
  }

  rebuildValueBets() {
    this.valueBets = [];
    Object.entries(this.predictions).forEach(([matchId, pred]) => {
      const f = this.fixtures.find(x => x.id === matchId);
      if (!f) return;
      (pred.valueBets || pred.analysisPicks?.slice(0, 6) || []).forEach(pick => {
        this.valueBets.push({
          matchId: f.id, match: `${f.homeTeam} vs ${f.awayTeam}`,
          stage: f.stage, date: f.kickoffUtc,
          market: pick.label, prob: pick.prob, odds: pick.odds,
          confidence: pick.confidence, type: pick.type,
          kelly: pick.kelly,
          recommendation: pred.recommendation
        });
      });
    });
    this.valueBets.sort((a, b) => b.prob - a.prob);
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
        if (this.oddsLive?.has(key)) {
          this.oddsLive.applyToMatchData(key, data);
        } else if (this.config.oddsApiKey) {
          if (!this.oddsEventsCache) this.oddsEventsCache = await this.apiClient.fetchOddsApiEvents();
          const oddsData = this.apiClient.parseOddsApiForMatch(this.oddsEventsCache, fixture.homeTeam, fixture.awayTeam);
          if (oddsData) {
            Object.assign(data, oddsData);
            data.dataSources.push('The Odds API (cuotas reales)');
          }
        }
        if (this.config.apifootballKey) {
          const [homeStats, awayStats, homeForm, awayForm, h2h] = await Promise.all([
            this.apiClient.fetchTeamStatistics(fixture.homeTeam),
            this.apiClient.fetchTeamStatistics(fixture.awayTeam),
            this.apiClient.fetchTeamForm(fixture.homeTeam),
            this.apiClient.fetchTeamForm(fixture.awayTeam),
            this.apiClient.fetchHeadToHead(fixture.homeTeam, fixture.awayTeam)
          ]);
          const leagueAvg = this.config.leagueAvgGoals || 1.35;
          const homeParsed = this.apiClient.parseTeamStatistics(homeStats, leagueAvg);
          const awayParsed = this.apiClient.parseTeamStatistics(awayStats, leagueAvg);
          if (homeParsed?.played >= 3) {
            data.homeAttack = homeParsed.attack;
            data.homeDefense = homeParsed.defense;
            data.homeXGFor = homeParsed.xgFor;
            data.homeXGAgainst = homeParsed.xgAgainst;
            data.dataSources.push('API-Football (stats local)');
          }
          if (awayParsed?.played >= 3) {
            data.awayAttack = awayParsed.attack;
            data.awayDefense = awayParsed.defense;
            data.awayXGFor = awayParsed.xgFor;
            data.awayXGAgainst = awayParsed.xgAgainst;
            data.dataSources.push('API-Football (stats visitante)');
          }
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
    } else if (this.oddsLive?.has(key)) {
      this.oddsLive.applyToMatchData(key, data);
    }

    data.dataSources = [...new Set(data.dataSources)];
    data.isVerified = this.isDataVerified(data.dataSources);
    this.matchDataCache[key] = data;
    return data;
  }

  isDataVerified(sources) {
    if (!sources?.length) return false;
    return sources.some(s => !/demo|simulado/i.test(s));
  }

  async refreshModelAccuracy() {
    if (!SupabaseClient.isConfigured()) {
      this.modelAccuracy = { hasData: false, hitRate: 0, sampleSize: 0, history: [] };
      this.modelHistory = [];
      return;
    }
    const result = await this.bets.computeModelBacktest();
    this.modelAccuracy = result;
    this.modelHistory = result.history;
  }

  renderConfidenceBadge(conf) {
    if (!conf) return '';
    const cls = (conf || '').toLowerCase();
    return `<span class="conf-badge ${cls}">${escapeHtml(conf)}</span>`;
  }

  renderDataTrustChip(sources, isVerified) {
    const verified = isVerified ?? this.isDataVerified(sources);
    const label = verified ? 'Datos verificados' : 'Modo demo';
    const src = sources?.length ? sources.filter(s => !/demo|simulado/i.test(s)).slice(0, 2).join(' · ') : 'Poisson + xG';
    return `<span class="data-trust-chip ${verified ? 'verified' : 'demo'}" title="${escapeHtml((sources || []).join(', '))}">
      <i data-lucide="${verified ? 'shield-check' : 'flask-conical'}" style="width:12px;height:12px"></i>
      ${verified ? label : label}${verified && src ? ` · ${escapeHtml(src)}` : ''}
    </span>`;
  }

  renderProbBar(p, homeLabel, awayLabel) {
    if (!p) return '';
    const h = Math.max(p.homeWin * 100, 1);
    const d = Math.max(p.draw * 100, 1);
    const a = Math.max(p.awayWin * 100, 1);
    return `
      <div class="prob-bar-labels">
        <span><strong>${pct(p.homeWin)}</strong> ${escapeHtml(homeLabel || '1')}</span>
        <span><strong>${pct(p.draw)}</strong> X</span>
        <span><strong>${pct(p.awayWin)}</strong> ${escapeHtml(awayLabel || '2')}</span>
      </div>
      <div class="prob-bar" role="img" aria-label="Probabilidades 1X2">
        <div class="prob-bar-seg home" style="width:${h}%"></div>
        <div class="prob-bar-seg draw" style="width:${d}%"></div>
        <div class="prob-bar-seg away" style="width:${a}%"></div>
      </div>`;
  }

  renderRecHero(rec, fixture) {
    if (!rec) return '';
    const kelly = rec.primaryKelly;
    const gain = kelly ? kelly.stakeSuggestion * ((rec.primaryOdds || 2) - 1) : 0;
    return `<div class="rec-hero">
      <div class="rec-hero-title">Apuesta recomendada ${this.renderConfidenceBadge(rec.primaryConfidence)}</div>
      <div class="rec-hero-pick">${escapeHtml(rec.primaryBet)}</div>
      <div class="rec-hero-meta">
        <span>Prob. <strong>${pct(rec.primaryProb)}</strong></span>
        ${rec.primaryOdds ? `<span>Cuota <strong>${rec.primaryOdds.toFixed(2)}</strong></span>` : ''}
        ${kelly ? `<span>Stake <strong>${euro(kelly.stakeSuggestion)}</strong></span>` : ''}
        ${gain > 0 ? `<span>Ganancia <strong>+${euro(gain)}</strong></span>` : ''}
      </div>
      ${rec.primaryReason ? `<p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:var(--space-2)">${escapeHtml(rec.primaryReason)}</p>` : ''}
    </div>`;
  }

  async computeAllPredictions() {
    const toProcess = this.getFixturesForPrediction();
    const matchIds = toProcess.map(f => f.id);
    if (SupabaseClient.isConfigured()) {
      await this.bets.loadSnapshotsForMatches(matchIds);
    }
    for (const f of toProcess) {
      const data = await this.getMatchData(f);
      if (!data) continue;
      const pred = PredictionEngine.runFullPrediction(f, data, this.config);
      this.predictions[f.id] = pred;
      await this.persistSnapshot(f.id, pred);
    }
    this.rebuildValueBets();
    if (SupabaseClient.isConfigured()) await this.refreshModelAccuracy();
  }

  refreshAllPredictions() {
    return this.computeAllPredictions();
  }

  refreshOddsUI() {
    Object.keys(this.oddsLive?.odds || {}).forEach((matchId) => {
      if (this.matchDataCache[matchId]) {
        this.oddsLive.applyToMatchData(matchId, this.matchDataCache[matchId]);
      }
    });
    if (['today', 'groups', 'knockout', 'dashboard', 'valuebets'].includes(this.currentView)) {
      this.render();
    }
    if (this.selectedMatchId && document.getElementById('modal-overlay')) {
      const pred = this.predictions[this.selectedMatchId];
      if (pred?.data) {
        const chips = document.getElementById('modal-odds-chips');
        if (chips) chips.outerHTML = this.renderOddsChips(this.selectedMatchId, pred.data, 'modal-odds-chips');
      }
    }
  }

  renderOddsChips(matchId, data, idAttr) {
    const h = data?.marketHomeOdds;
    const d = data?.marketDrawOdds;
    const a = data?.marketAwayOdds;
    if (!h) return '';
    const ol = this.oddsLive;
    const fc = (f) => ol?.chipClass(matchId, f) || '';
    const ar = (f) => ol?.arrow(matchId, f) || '';
    const id = idAttr ? ` id="${idAttr}"` : '';
    return `<div class="odds-row"${id}>
      <div class="odds-chip ${fc('home')}"><span class="odds-lbl">1</span><strong>${h.toFixed(2)}${ar('home')}</strong></div>
      <div class="odds-chip ${fc('draw')}"><span class="odds-lbl">X</span><strong>${d ? d.toFixed(2) : '—'}${ar('draw')}</strong></div>
      <div class="odds-chip ${fc('away')}"><span class="odds-lbl">2</span><strong>${a ? a.toFixed(2) : '—'}${ar('away')}</strong></div>
    </div>`;
  }

  renderAnalysisPickRow(v) {
    return `<div class="analysis-pick-row" style="padding:var(--space-3);background:var(--color-surface-offset);border-radius:var(--radius-md);margin-bottom:var(--space-2)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-2);flex-wrap:wrap">
        <strong>${escapeHtml(v.label)}</strong> ${this.renderConfidenceBadge(v.confidence)}
      </div>
      <span style="font-size:var(--text-sm)">@ ${v.odds.toFixed(2)} · Prob. modelo: ${pct(v.prob)} · Kelly 1/4: ${pct(v.kelly.recommendedBet)} (€${v.kelly.stakeSuggestion.toFixed(2)})</span>
    </div>`;
  }

  renderAnalysisPicksSection(picks) {
    if (!picks?.length) return '<p style="color:var(--color-text-muted)">Sin apuestas para este partido</p>';
    const sorted = [...picks].sort((a, b) => b.prob - a.prob);
    const top = sorted.slice(0, 3);
    const rest = sorted.slice(3);
    let html = top.map(v => this.renderAnalysisPickRow(v)).join('');
    if (rest.length) {
      html += `<details class="analysis-picks-more">
        <summary>Ver ${rest.length} apuesta${rest.length === 1 ? '' : 's'} más</summary>
        ${rest.map(v => this.renderAnalysisPickRow(v)).join('')}
      </details>`;
    }
    return html;
  }

  renderRecPickRows(picks) {
    if (!picks?.length) return '';
    const sorted = [...picks].sort((a, b) => b.prob - a.prob);
    const top = sorted.slice(0, 3);
    const rest = sorted.slice(3);
    const row = (p) => `<div class="rec-pick-row">
      <span>${escapeHtml(p.label)}</span>
      <span>${pct(p.prob)} · @ ${p.odds.toFixed(2)} <span class="rec-conf rec-conf-${p.confidence.toLowerCase()}">${p.confidence}</span></span>
    </div>`;
    let html = top.map(row).join('');
    if (rest.length) {
      html += `<details class="analysis-picks-more">
        <summary>Ver ${rest.length} opción${rest.length === 1 ? '' : 'es'} más</summary>
        ${rest.map(row).join('')}
      </details>`;
    }
    return html;
  }

  renderRecBox(rec, compact) {
    if (!rec) return '';
    const confCls = rec.primaryConfidence === 'ALTA' ? 'rec-box-value' : rec.primaryConfidence === 'CULEBRA' ? 'rec-box-culebra' : 'rec-box-model';
    const goalsLine = rec.goalsNote
      ? `${rec.expectedTotalGoals} esp. · ${escapeHtml(rec.goalsPick)} (${pct(rec.goalsPickProb)})`
      : `${rec.expectedTotalGoals} esp. · ${escapeHtml(rec.goalsPick)}`;
    if (compact) {
      return `<div class="rec-box ${confCls} compact">
        <div class="rec-primary">${escapeHtml(rec.primaryAction)} <strong>${escapeHtml(rec.primaryBet)}</strong>
        ${rec.primaryOdds ? `<span class="rec-odds-big">${rec.primaryOdds.toFixed(2)}</span>` : ''}</div>
        <div class="rec-detail">${pct(rec.primaryProb)} · Marcador ${rec.likelyScore} · ${goalsLine}</div>
      </div>`;
    }
    const picksHtml = this.renderRecPickRows(rec.picks || []);
    return `<div class="rec-box ${confCls}">
      <div class="rec-label">APUESTA RECOMENDADA · ${rec.primaryConfidence || 'ANÁLISIS'}</div>
      <div class="rec-primary">${escapeHtml(rec.primaryAction)} <strong>${escapeHtml(rec.primaryBet)}</strong>
        ${rec.primaryOdds ? `<span class="rec-odds-big">${rec.primaryOdds.toFixed(2)}</span>` : ''}
        <span style="font-size:var(--text-sm);color:var(--color-text-muted)">(${pct(rec.primaryProb)})</span></div>
      ${rec.primaryReason ? `<div class="rec-detail" style="margin-bottom:var(--space-2)">${escapeHtml(rec.primaryReason)}</div>` : ''}
      <div class="rec-grid">
        <div><span class="rec-k">Ganador modelo</span><br>${escapeHtml(rec.modelWinner)} (${pct(rec.modelWinnerProb)})</div>
        <div><span class="rec-k">Marcador probable</span><br>${rec.likelyScore} (${pct(rec.likelyScoreProb)})</div>
        <div><span class="rec-k">Goles totales</span><br>${goalsLine}</div>
        <div><span class="rec-k">Primer gol</span><br>${escapeHtml(rec.firstGoalPick)} (${pct(rec.firstGoalProb)})</div>
        ${rec.primaryKelly ? `<div><span class="rec-k">Kelly 1/4</span><br>${euro(rec.primaryKelly.stakeSuggestion)}</div>` : ''}
      </div>
      ${rec.goalsNote ? `<div class="rec-detail" style="margin:var(--space-2) 0;font-size:var(--text-xs)">ℹ️ ${escapeHtml(rec.goalsNote)}</div>` : ''}
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
    return this.fixtures.filter(f => !f.isPlaceholder && f.status !== 'finished' && new Date(f.kickoffUtc) > now)
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
    if (this.filters.status) list = list.filter(f => f.status === this.filters.status);
    return list.sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));
  }

  matchStatusBadge(f) {
    const labels = { scheduled: 'Programado', live: 'En juego', finished: 'Finalizado' };
    const cls = { scheduled: 'badge-group', live: 'badge-value', finished: 'badge-tbd' };
    return `<span class="badge ${cls[f.status] || 'badge-group'}">${labels[f.status] || f.status}</span>`;
  }

  navigate(view) {
    this.currentView = view;
    ChartManager.destroyAll();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    document.querySelectorAll('[data-bottom-nav]').forEach(n => n.classList.toggle('active', n.dataset.view === view));
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
      case 'mybets': main.innerHTML = this.renderMyBets(); break;
      case 'history': main.innerHTML = this.renderHistory(); break;
      case 'ai': main.innerHTML = this.renderAIAnalysis(); break;
      case 'settings': main.innerHTML = this.renderSettings(); break;
    }
    lucide.createIcons();
    if (this.currentView === 'dashboard') {
      this.initDashboardCharts();
      this.animateKPIs();
    }
    if (this.currentView === 'history') this.loadHistoryView();
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
    if (!this.modelAccuracy?.hasData || !this.modelHistory?.length) return;
    setTimeout(() => ChartManager.createPerformanceLine('chart-performance', this.modelHistory), 100);
  }

  renderDashboard() {
    const next = this.getNextMatch();
    const todayBets = this.valueBets.filter(v => v.date?.slice(0, 10) === new Date().toISOString().slice(0, 10));
    const top3 = this.valueBets.slice(0, 3);
    const acc = this.modelAccuracy;
    const accuracyLabel = acc.hasData ? acc.hitRate : null;
    const userStats = this.bets.getStats();
    const roi = this.auth.isLoggedIn ? userStats.roi : null;
    const trustChip = this.renderDataTrustChip(
      this.apiTrust.trusted ? this.apiTrust.validSources : ['Demo'],
      this.apiTrust.trusted
    );
    return `
      <h1 class="view-title">Dashboard</h1>
      <div style="margin-bottom:var(--space-4)">${trustChip}</div>
      ${!SupabaseClient.isConfigured() ? '<p style="color:var(--color-warning);margin-bottom:var(--space-4);font-size:var(--text-sm)">Configura Supabase en el build para guardar apuestas y usuarios.</p>' : ''}
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Partidos</div><div class="kpi-value" data-countup="${this.fixtures.length}">0</div></div>
        <div class="kpi-card"><div class="kpi-label">Apuestas Hoy</div><div class="kpi-value" data-countup="${todayBets.length || this.valueBets.length}">0</div></div>
        <div class="kpi-card">
          <div class="kpi-label">Precisión Modelo</div>
          ${accuracyLabel != null
            ? `<div class="kpi-value" data-countup="${accuracyLabel}" data-suffix="%" data-decimals="1">0</div>
               <div style="font-size:10px;color:var(--color-text-muted);margin-top:4px">${acc.sampleSize} partidos evaluados</div>`
            : `<div class="kpi-value" style="font-size:var(--text-lg)">—</div>
               <div style="font-size:10px;color:var(--color-text-muted);margin-top:4px">Sin datos aún</div>`}
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${this.auth.isLoggedIn ? 'Tu ROI' : 'ROI Modelo'}</div>
          ${roi != null
            ? `<div class="kpi-value" data-countup="${roi.toFixed(1)}" data-suffix="%" data-decimals="1">0</div>`
            : `<div class="kpi-value" style="font-size:var(--text-lg)">—</div>
               <div style="font-size:10px;color:var(--color-text-muted);margin-top:4px">Inicia sesión</div>`}
        </div>
      </div>
      <div class="grid-2">
        <div class="card next-match-card">
          <h2 class="card-title">Próximo Partido</h2>
          ${next ? `
            <div class="match-teams">
              <span class="team"><img src="${flagUrl(next.homeTeam)}" alt="" loading="lazy" width="32" height="22">${escapeHtml(next.homeTeam)}</span>
              <span class="vs">VS</span>
              <span class="team">${escapeHtml(next.awayTeam)}<img src="${flagUrl(next.awayTeam)}" alt="" loading="lazy" width="32" height="22"></span>
            </div>
            <p class="match-meta">${formatDate(next.kickoffUtc)} · ${formatTime(next.kickoffUtc)} · ${escapeHtml(next.stadium)}</p>
            ${this.predictions[next.id]?.prediction ? this.renderProbBar(this.predictions[next.id].prediction, next.homeTeam, next.awayTeam) : ''}
            ${this.predictions[next.id]?.recommendation ? this.renderRecBox(this.predictions[next.id].recommendation, true) : ''}
            <div class="countdown countdown-lg" id="countdown-timer">--:--:--</div>
            <button class="btn btn-primary" style="margin-top:var(--space-4);width:100%" data-match="${next.id}">Ver Predicción</button>
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
        ${acc.hasData
          ? `<p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3)">Hit rate real: ${acc.hitRate}% sobre ${acc.sampleSize} predicciones con resultado</p>
             <div class="chart-box"><canvas id="chart-performance" height="200"></canvas></div>`
          : `<div class="empty-state" style="padding:var(--space-8)"><p>El gráfico aparecerá cuando haya partidos finalizados con snapshots guardados.</p></div>`}
      </div>`;
  }

  renderKnockoutBracket(list) {
    const rounds = ['round-of-32', 'round-of-16', 'quarter-finals', 'semi-finals', 'third-place', 'final'];
    const byRound = {};
    list.forEach(f => {
      const stage = f.stage || 'other';
      if (!byRound[stage]) byRound[stage] = [];
      byRound[stage].push(f);
    });
    const html = rounds.filter(r => byRound[r]?.length).map(round => `
      <div class="bracket-round">
        <div class="bracket-round-title">${STAGE_LABELS[round] || round}</div>
        <div class="bracket-matches">
          ${byRound[round].map(f => {
            const homeW = f.status === 'finished' && f.homeScore > f.awayScore;
            const awayW = f.status === 'finished' && f.awayScore > f.homeScore;
            return `<div class="bracket-slot" data-match="${f.id}" role="button" tabindex="0">
              <div class="bracket-team ${homeW ? 'winner' : ''}">
                <img src="${flagUrl(f.homeTeam)}" alt="" loading="lazy">${escapeHtml(f.homeTeam)}
                ${f.status === 'finished' ? `<span class="bracket-score">${f.homeScore}</span>` : ''}
              </div>
              <div class="bracket-team ${awayW ? 'winner' : ''}">
                <img src="${flagUrl(f.awayTeam)}" alt="" loading="lazy">${escapeHtml(f.awayTeam)}
                ${f.status === 'finished' ? `<span class="bracket-score">${f.awayScore}</span>` : ''}
              </div>
              <p style="font-size:10px;color:var(--color-text-muted);margin-top:var(--space-2)">${formatDate(f.kickoffUtc)} · ${formatTime(f.kickoffUtc)}</p>
            </div>`;
          }).join('')}
        </div>
      </div>
    `).join('');
    return `<div class="knockout-bracket">${html || '<div class="empty-state card"><p>Sin partidos eliminatorios</p></div>'}</div>`;
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
        <select id="filter-status"><option value="">Todos los estados</option>
          <option value="scheduled" ${this.filters.status==='scheduled'?'selected':''}>Programado</option>
          <option value="live" ${this.filters.status==='live'?'selected':''}>En juego</option>
          <option value="finished" ${this.filters.status==='finished'?'selected':''}>Finalizado</option>
        </select>
        <input type="search" id="filter-team" placeholder="Buscar equipo..." value="${escapeHtml(this.filters.team)}">
      </div>
      ${view === 'knockout' && list.length ? this.renderKnockoutBracket(list) : ''}
      ${view !== 'knockout' && list.length ? `<div class="match-grid">${list.map(f => this.renderMatchCard(f)).join('')}</div>` :
        view !== 'knockout' ? '<div class="empty-state card"><div class="empty-icon">⚽</div><p>Sin partidos con estos filtros</p></div>' :
        !list.length ? '<div class="empty-state card"><div class="empty-icon">⚽</div><p>Sin partidos con estos filtros</p></div>' : ''}
    `;
  }

  renderMatchCard(f) {
    const pred = this.predictions[f.id];
    const rec = pred?.recommendation;
    const d = pred?.data;
    const p = pred?.prediction;
    const hasPick = pred?.recommendation?.primaryBet;
    return `
      <article class="match-card">
        <div class="match-teams">
          <span class="team"><img src="${flagUrl(f.homeTeam)}" alt="" loading="lazy" width="28" height="20">${escapeHtml(f.homeTeam)}</span>
          <span class="vs">VS</span>
          <span class="team">${escapeHtml(f.awayTeam)}<img src="${flagUrl(f.awayTeam)}" alt="" loading="lazy" width="28" height="20"></span>
        </div>
        ${p ? this.renderProbBar(p, '1', '2') : ''}
        <div class="match-meta">
          ${formatDate(f.kickoffUtc)} · ${formatTime(f.kickoffUtc)}<br>
          ${escapeHtml(f.stadium)}, ${escapeHtml(f.hostCity)}
        </div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3);align-items:center">
          ${f.group ? `<span class="badge badge-group">Grupo ${f.group}</span>` : ''}
          <span class="badge badge-group">${STAGE_LABELS[f.stage] || f.stage}</span>
          ${this.matchStatusBadge(f)}
          ${f.isPlaceholder ? '<span class="badge badge-tbd">Por definir</span>' : ''}
          ${hasPick ? this.renderConfidenceBadge(rec.primaryConfidence) : ''}
        </div>
        ${d ? this.renderDataTrustChip(d.dataSources, d.isVerified) : ''}
        ${f.status === 'finished' && f.homeScore != null ? `<p style="font-weight:600;margin-bottom:var(--space-2)">Resultado: ${f.homeScore} - ${f.awayScore}</p>` : ''}
        ${f.isPlaceholder
          ? '<p style="font-size:var(--text-sm);color:var(--color-text-muted)">Equipos por definir</p>'
          : `${d ? this.renderOddsChips(f.id, d) : '<div class="skeleton" style="min-height:48px;margin:var(--space-2) 0"></div>'}
          ${rec ? this.renderRecBox(rec, true) : ''}
          <button class="btn btn-primary" data-match="${f.id}" style="margin-top:var(--space-3)">Ver Análisis</button>`}
      </article>`;
  }

  renderUserBetRow(b) {
    const m = b.matches || {};
    const matchLabel = m.home_team ? `${m.home_team} vs ${m.away_team}` : b.match_id;
    const pl = b.status === 'won' ? `+${euro(b.payout)}` : b.status === 'lost' ? `-${euro(b.stake)}` : '—';
    const resultSuffix = m.status === 'finished' && m.home_score != null ? `<br><small>${m.home_score}-${m.away_score}</small>` : '';
    return {
      matchLabel,
      pl,
      tableRow: `<tr>
        <td>${escapeHtml(matchLabel)}${resultSuffix}</td>
        <td>${escapeHtml(b.market_label)}</td>
        <td>${Number(b.odds).toFixed(2)}</td>
        <td>${euro(b.stake)}</td>
        <td class="${this.bets.statusClass(b.status)}">${this.bets.statusLabel(b.status)}</td>
        <td class="${this.bets.statusClass(b.status)}">${pl}</td>
        <td>${new Date(b.placed_at).toLocaleDateString('es-ES')}</td>
      </tr>`,
      mobileCard: `<div class="bet-card">
        <strong>${escapeHtml(matchLabel)}</strong>
        ${m.status === 'finished' && m.home_score != null ? `<div class="bet-card-row"><span>Resultado</span><span>${m.home_score}-${m.away_score}</span></div>` : ''}
        <div class="bet-card-row"><span>Mercado</span><span>${escapeHtml(b.market_label)}</span></div>
        <div class="bet-card-row"><span>Cuota</span><span class="rec-odds-big" style="font-size:var(--text-lg)">${Number(b.odds).toFixed(2)}</span></div>
        <div class="bet-card-row"><span>Stake</span><span>${euro(b.stake)}</span></div>
        <div class="bet-card-row"><span>Estado</span><span class="${this.bets.statusClass(b.status)}">${this.bets.statusLabel(b.status)}</span></div>
        <div class="bet-card-row"><span>P/L</span><span class="${this.bets.statusClass(b.status)}">${pl}</span></div>
        <div class="bet-card-row"><span>Fecha</span><span>${new Date(b.placed_at).toLocaleDateString('es-ES')}</span></div>
      </div>`
    };
  }

  renderUserBetsSection({ compact = false } = {}) {
    if (!SupabaseClient.isConfigured()) {
      return `<section class="user-bets-section">
        <h2 class="card-title">Tus apuestas</h2>
        <p style="color:var(--color-text-muted);font-size:var(--text-sm)">Backend no configurado</p>
      </section>`;
    }
    if (!this.auth.isLoggedIn) {
      return `<section class="user-bets-section">
        <h2 class="card-title">Tus apuestas</h2>
        <div class="empty-state card" style="padding:var(--space-4)">
          <p>Inicia sesión para ver tus apuestas</p>
          <button class="btn btn-primary" id="btn-dash-login" type="button">Entrar</button>
        </div>
      </section>`;
    }
    const stats = this.bets.getStats();
    let bets = [...this.bets.userBets];
    if (this.betFilter) bets = bets.filter(b => b.status === this.betFilter);
    const kpiGrid = compact
      ? `<div class="kpi-grid user-bets-kpi-compact" style="margin-bottom:var(--space-4)">
          <div class="kpi-card"><div class="kpi-label">Bankroll</div><div class="kpi-value">${euro(this.auth.profile?.bankroll ?? this.config.bankroll)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Pendientes</div><div class="kpi-value">${stats.pending}</div></div>
        </div>`
      : `<div class="kpi-grid" style="margin-bottom:var(--space-4)">
          <div class="kpi-card"><div class="kpi-label">Bankroll</div><div class="kpi-value">${euro(this.auth.profile?.bankroll ?? this.config.bankroll)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Ganadas</div><div class="kpi-value value-high">${stats.won}</div></div>
          <div class="kpi-card"><div class="kpi-label">Perdidas</div><div class="kpi-value value-low">${stats.lost}</div></div>
          <div class="kpi-card"><div class="kpi-label">Pendientes</div><div class="kpi-value">${stats.pending}</div></div>
        </div>`;
    const rows = bets.map(b => this.renderUserBetRow(b));
    return `<section class="user-bets-section${compact ? ' user-bets-section--compact' : ''}">
      <h2 class="card-title">Tus apuestas</h2>
      ${kpiGrid}
      <div class="filters">
        <select id="bet-filter-status">
          <option value="">Todas</option>
          <option value="pending" ${this.betFilter==='pending'?'selected':''}>Pendientes</option>
          <option value="won" ${this.betFilter==='won'?'selected':''}>Ganadas</option>
          <option value="lost" ${this.betFilter==='lost'?'selected':''}>Perdidas</option>
        </select>
        <button class="btn btn-outline" id="btn-refresh-bets" type="button">Actualizar</button>
      </div>
      ${bets.length ? `
        <div class="card table-wrap desktop-only">
          <table>
            <thead><tr><th>Partido</th><th>Mercado</th><th>Cuota</th><th>Stake</th><th>Estado</th><th>P/L</th><th>Fecha</th></tr></thead>
            <tbody>${rows.map(r => r.tableRow).join('')}</tbody>
          </table>
        </div>
        <div class="mobile-cards">${rows.map(r => r.mobileCard).join('')}</div>` : '<div class="empty-state card"><p>No tienes apuestas aún. Abre un partido y pulsa Guardar apuesta.</p></div>'}
    </section>`;
  }

  renderValueBets() {
    let bets = [...this.valueBets];
    if (this.vbFilters.confidence) bets = bets.filter(b => b.confidence === this.vbFilters.confidence);
    if (this.vbFilters.stage) bets = bets.filter(b => b.stage === this.vbFilters.stage);
    const userBetMatchIds = new Set(this.auth.isLoggedIn ? this.bets.getUserBetMatchIds() : []);
    const alreadyBetBadge = (matchId) => userBetMatchIds.has(matchId)
      ? ' <span class="badge badge-tbd">Ya apostaste</span>' : '';
    return `
      <h1 class="view-title">Apuestas</h1>
      ${this.renderUserBetsSection({ compact: true })}
      <h2 class="card-title" style="margin-top:var(--space-2)">Recomendadas del modelo</h2>
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
        <div class="card table-wrap desktop-only">
          <table>
            <thead><tr>
              <th>Partido</th><th>Mercado</th><th>Cuota</th><th>Prob. Modelo</th>
              <th>Confianza</th><th>Kelly</th><th>Tipo</th>
            </tr></thead>
            <tbody>${bets.map(b => `
              <tr>
                <td>${escapeHtml(b.match)}${alreadyBetBadge(b.matchId)}</td>
                <td>${escapeHtml(b.market)}</td>
                <td>${b.odds.toFixed(2)}</td>
                <td>${pct(b.prob)}</td>
                <td class="${b.confidence==='ALTA'?'value-high':b.confidence==='MEDIA'?'value-med':'value-low'}">${b.confidence}</td>
                <td>${pct(b.kelly.recommendedBet)}</td>
                <td>${escapeHtml(b.type || '')}</td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
        <div class="mobile-cards">${bets.map(b => `
          <div class="vb-card">
            <strong>${escapeHtml(b.match)}</strong>${alreadyBetBadge(b.matchId)}
            <div class="bet-card-row"><span>Mercado</span><span>${escapeHtml(b.market)}</span></div>
            <div class="bet-card-row"><span>Cuota</span><span class="rec-odds-big" style="font-size:var(--text-lg)">${b.odds.toFixed(2)}</span></div>
            <div class="bet-card-row"><span>Prob. modelo</span><span>${pct(b.prob)}</span></div>
            <div class="bet-card-row"><span>Confianza</span><span class="${b.confidence==='ALTA'?'value-high':b.confidence==='MEDIA'?'value-med':'value-low'}">${b.confidence}</span></div>
            <div class="bet-card-row"><span>Kelly 1/4</span><span>${pct(b.kelly.recommendedBet)}</span></div>
          </div>
        `).join('')}</div>` : '<div class="empty-state card"><div class="empty-icon">⚽</div><p>No hay apuestas recomendadas</p></div>'}
    `;
  }

  renderMyBets() {
    return `<h1 class="view-title">Mis Apuestas</h1>${this.renderUserBetsSection({ compact: false })}`;
  }

  renderHistory() {
    return `
      <h1 class="view-title">Historial de Sugerencias</h1>
      <p style="color:var(--color-text-muted);margin-bottom:var(--space-4);font-size:var(--text-sm)">Predicciones guardadas del modelo, incluso para partidos ya jugados.</p>
      <div id="history-list"><div class="skeleton" style="height:120px"></div></div>
    `;
  }

  async loadHistoryView() {
    const el = document.getElementById('history-list');
    if (!el) return;
    if (!SupabaseClient.isConfigured()) {
      el.innerHTML = '<div class="empty-state card"><p>Backend no configurado</p></div>';
      return;
    }
    const snapshots = await this.bets.loadLatestSnapshots(40);
    if (!snapshots.length) {
      el.innerHTML = '<div class="empty-state card"><p>Aún no hay snapshots. Se guardan al analizar partidos.</p></div>';
      return;
    }
    el.innerHTML = snapshots.map(s => {
      const m = s.matches || {};
      const rec = s.recommendation || {};
      const result = m.status === 'finished' && m.home_score != null
        ? `<span class="badge badge-tbd">Resultado: ${m.home_score}-${m.away_score}</span>` : '';
      return `<div class="card" style="margin-bottom:var(--space-3)">
        <strong>${escapeHtml(m.home_team || '')} vs ${escapeHtml(m.away_team || '')}</strong>
        ${result}
        <p style="font-size:var(--text-sm);margin:var(--space-2) 0">${escapeHtml(rec.summary || rec.primaryBet || '')}</p>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted)">Actualizado: ${new Date(s.computed_at).toLocaleString('es-ES')}</p>
      </div>`;
    }).join('');
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
      <h1 class="view-title">Perfil y configuración</h1>
      ${this.renderAuthSettingsCard()}
      <div class="card settings-form">
        <p style="color:var(--color-text-muted);margin-bottom:var(--space-4);font-size:var(--text-sm)">
          Las API keys se cargan desde variables de entorno en el build, o puedes configurarlas aquí (solo memoria de sesión).
        </p>
        <div class="form-group"><label>TheStatsAPI Key</label>
          <input type="password" id="cfg-thestats" value="${escapeHtml(this.config.thestatsapiKey)}" autocomplete="off"></div>
        <div class="form-group"><label>WorldCupAPI Key</label>
          <input type="password" id="cfg-worldcup" value="${escapeHtml(this.config.worldcupApiKey)}" autocomplete="off"></div>
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-4)">
          Las cuotas de mercado se sincronizan cada ~4 min desde el servidor (Supabase Edge Function). No necesitas The Odds API en el cliente.
        </p>
        <div class="form-group"><label>API-Football Key (RapidAPI)</label>
          <input type="password" id="cfg-apifootball" value="${escapeHtml(this.config.apifootballKey)}" autocomplete="off"></div>
        <div class="form-group"><label>Proxy CORS (opcional)</label>
          <input type="text" id="cfg-proxy" value="${escapeHtml(this.config.corsProxy)}" placeholder="https://corsproxy.io/?"></div>
        <div class="form-group"><label>Bankroll virtual (€)</label>
          <p id="cfg-bankroll-display" class="bankroll-chip" style="display:inline-flex">${euro(this.getBankroll())}</p>
          <p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:var(--space-2)">No editable. Se actualiza al liquidar apuestas.</p></div>
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
    ['filter-group','filter-stage','filter-date','filter-status'].forEach(id => {
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
    document.getElementById('btn-dash-login')?.addEventListener('click', () => this.openAuthModal());
    document.getElementById('bet-filter-status')?.addEventListener('change', e => {
      this.betFilter = e.target.value;
      this.render();
    });
    document.getElementById('btn-refresh-bets')?.addEventListener('click', async () => {
      await this.bets.loadUserBets();
      await SupabaseClient.invokeFunction('settle-bets');
      await this.auth.loadProfile();
      this.updateBankrollDisplay();
      this.render();
      this.showToast('Apuestas actualizadas');
    });
    this.bindSettingsAuthEvents();
  }

  async openMatchModal(matchId) {
    const fixture = this.fixtures.find(f => f.id === matchId);
    if (!fixture || fixture.isPlaceholder) return;
    this.selectedMatchId = matchId;
    let pred = this.predictions[matchId];
    if (!pred) pred = await this.ensurePrediction(matchId);
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
            ${this.renderDataTrustChip(d.dataSources, d.isVerified)}
            ${pred.recommendation ? this.renderRecHero(pred.recommendation, fixture) : ''}
            <div class="grid-2">
              <div>
                <h3 style="margin-bottom:var(--space-3)">Predicción del Modelo</h3>
                ${this.renderProbBar(p, fixture.homeTeam, fixture.awayTeam)}
                <p style="margin:var(--space-3) 0"><strong>Score más probable:</strong> ${p.mostLikelyScore.home}-${p.mostLikelyScore.away} (${pct(p.mostLikelyScore.probability)})</p>
                <p><strong>Top 5:</strong> ${p.top5Scores.map(s => `${s.home}-${s.away}`).join(', ')}</p>
                <p><strong>Goles esperados:</strong> ${(p.expectedHomeGoals + p.expectedAwayGoals).toFixed(1)}</p>
              </div>
              <div>
                <h3 style="margin-bottom:var(--space-3)">Cuotas de Mercado</h3>
                ${this.renderOddsChips(matchId, d, 'modal-odds-chips')}
                ${Object.entries(d.bookmakers).map(([name, o]) =>
                  `<p style="font-size:var(--text-sm);margin:var(--space-2) 0"><strong>${name}:</strong> ${o.home.toFixed(2)} / ${o.draw.toFixed(2)} / ${o.away.toFixed(2)}</p>`
                ).join('')}
                <p style="font-size:var(--text-xs);color:var(--color-text-muted)">Línea: ${d.lineMovement.direction} (${d.lineMovement.opening.toFixed(2)} → ${d.lineMovement.current.toFixed(2)})</p>
              </div>
            </div>
            <h3 style="margin:var(--space-4) 0 var(--space-3)">Apuestas del Análisis</h3>
            ${this.renderAnalysisPicksSection(pred.analysisPicks)}
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
              <span class="bankroll-chip" id="bet-bankroll" aria-label="Bankroll">${euro(this.getBankroll())}</span>
              <select id="bet-market">${pred.analysisPicks?.length ? pred.analysisPicks.map((v,i) =>
                `<option value="${i}" data-odds="${v.odds}" data-prob="${v.prob}" data-type="${escapeHtml(v.type)}">${escapeHtml(v.label)}</option>`
              ).join('') : `<option value="0" data-odds="${d.marketHomeOdds}" data-prob="${p.homeWin}" data-type="ganador">${escapeHtml(fixture.homeTeam)} gana</option>`}</select>
              <input type="number" id="bet-odds" step="0.01" value="${pred.analysisPicks?.[0]?.odds || d.marketHomeOdds}" aria-label="Cuota">
              <input type="number" id="bet-stake" step="1" min="1" placeholder="Stake €" aria-label="Stake">
            </div>
            <p id="bet-result" style="margin-top:var(--space-3);font-weight:600"></p>
            ${SupabaseClient.isConfigured() ? `
              <button class="btn btn-primary" id="btn-save-bet" type="button" style="margin-top:var(--space-3)" ${!this.auth.isLoggedIn ? 'disabled title="Inicia sesión"' : ''}>
                ${this.auth.isLoggedIn ? 'Guardar apuesta' : 'Inicia sesión para guardar'}
              </button>
              ${new Date(fixture.kickoffUtc) <= new Date() ? '<p style="color:var(--color-warning);font-size:var(--text-sm);margin-top:var(--space-2)">Partido ya empezado — no se pueden guardar nuevas apuestas</p>' : ''}
            ` : ''}
            <details class="chart-accordion">
              <summary>Gráficos y mapa de calor</summary>
            <div class="chart-tabs" id="chart-tabs">
              <button type="button" class="chart-tab active" data-chart-tab="prob">Probabilidades</button>
              <button type="button" class="chart-tab" data-chart-tab="goals">Goles</button>
              <button type="button" class="chart-tab" data-chart-tab="xg">xG</button>
            </div>
            <div class="chart-panel" data-chart-panel="prob">
              <div class="chart-box"><canvas id="chart-prob" height="180"></canvas></div>
            </div>
            <div class="chart-panel" data-chart-panel="goals" style="display:none">
              <div class="chart-box"><canvas id="chart-goals" height="180"></canvas></div>
            </div>
            <div class="chart-panel" data-chart-panel="xg" style="display:none">
              <div class="chart-box"><canvas id="chart-xg" height="180"></canvas></div>
            </div>
            <div class="chart-box" style="margin-top:var(--space-4)">
              <h4 style="margin-bottom:var(--space-3)">Mapa de Calor de Resultados</h4>
              <div id="chart-heatmap"></div>
            </div>
            </details>
          </div>
        </div>
      </div>`;
    lucide.createIcons();
    document.querySelectorAll('#chart-tabs [data-chart-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.chart-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('[data-chart-panel]').forEach(p => {
          p.style.display = p.dataset.chartPanel === tab.dataset.chartTab ? '' : 'none';
        });
      });
    });
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') this.closeModal();
    });
    const updateBet = () => {
      const bankroll = this.getBankroll();
      const odds = parseFloat(document.getElementById('bet-odds').value) || 2;
      const stakeEl = document.getElementById('bet-stake');
      const sel = document.getElementById('bet-market');
      const prob = parseFloat(sel.selectedOptions[0]?.dataset.prob) || 0.5;
      const kelly = PredictionEngine.kellyCriterion(prob, odds, bankroll, this.config.kellyFraction);
      if (stakeEl && !stakeEl.value) stakeEl.placeholder = kelly.stakeSuggestion.toFixed(2);
      const stakeRaw = stakeEl?.value?.trim();
      const stake = stakeRaw !== '' && Number.isFinite(parseFloat(stakeRaw)) ? parseFloat(stakeRaw) : kelly.stakeSuggestion;
      const gain = stake * (odds - 1);
      document.getElementById('bet-result').textContent =
        `Apostar: €${stake.toFixed(2)} | Ganancia potencial: +€${gain.toFixed(2)} | Riesgo: ${kelly.riskLevel}`;
    };
    ['bet-market','bet-odds','bet-stake'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const handler = () => {
        if (id === 'bet-market') document.getElementById('bet-odds').value = el.selectedOptions[0]?.dataset.odds;
        updateBet();
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
    updateBet();
    document.getElementById('btn-save-bet')?.addEventListener('click', async () => {
      if (!this.auth.isLoggedIn) { this.openAuthModal(); return; }
      const sel = document.getElementById('bet-market');
      const opt = sel.selectedOptions[0];
      const stake = parseFloat(document.getElementById('bet-stake').value);
      const odds = parseFloat(document.getElementById('bet-odds').value);
      if (!stake || stake <= 0) { this.showToast('Indica un stake válido'); return; }
      try {
        const snapshotId = this.bets.snapshots[matchId]?.id
          || await this.persistSnapshot(matchId, pred);
        await this.bets.placeBet({
          matchId,
          marketType: opt.dataset.type || 'ganador',
          marketLabel: opt.textContent,
          odds,
          stake,
          snapshotId
        });
        this.showToast('Apuesta guardada');
        await this.auth.loadProfile();
        this.updateBankrollDisplay();
        updateBet();
        if (this.currentView === 'valuebets' || this.currentView === 'mybets') this.render();
      } catch (e) {
        this.showToast(e.message);
      }
    });
    setTimeout(() => {
      ChartManager.createProbDoughnut('chart-prob', [p.homeWin, p.draw, p.awayWin],
        [fixture.homeTeam, 'Empate', fixture.awayTeam]);
      ChartManager.createGoalsBar('chart-goals', pred.adjusted.adjustedHomeLambda, pred.adjusted.adjustedAwayLambda);
      ChartManager.createXGBar('chart-xg', d, fixture.homeTeam, fixture.awayTeam);
      ChartManager.renderHeatmap('chart-heatmap', p.scoreProbabilities);
    }, 150);
    this.showToast('Análisis cargado');
    this._lockScroll();
  }

  _isMobileLayout() {
    return window.innerWidth <= 768;
  }

  _lockScroll() {
    const main = document.getElementById('main-content');
    if (this._isMobileLayout() && main) {
      this._mainScrollTop = main.scrollTop;
    } else {
      this._scrollY = window.scrollY;
      document.body.style.top = `-${this._scrollY}px`;
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    }
    document.body.classList.add('modal-open');
  }

  _unlockScroll() {
    document.body.classList.remove('modal-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    const main = document.getElementById('main-content');
    if (this._isMobileLayout() && main) {
      main.scrollTop = this._mainScrollTop || 0;
    } else {
      window.scrollTo(0, this._scrollY || 0);
    }
  }

  closeModal() {
    this._unlockScroll();
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
    this.config.apifootballKey = document.getElementById('cfg-apifootball').value;
    this.config.corsProxy = document.getElementById('cfg-proxy').value;
    this.config.bankroll = this.getBankroll();
    this.config.kellyFraction = parseFloat(document.getElementById('cfg-kelly').value);
    this.config.minEdge = parseFloat(document.getElementById('cfg-minedge').value);
    this.apiClient = new ApiClient(this.config);
    this.updateBankrollDisplay();
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
    this.config.apifootballKey = g('cfg-apifootball').value;
    this.config.corsProxy = g('cfg-proxy').value;
    this.config.bankroll = this.getBankroll();
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
