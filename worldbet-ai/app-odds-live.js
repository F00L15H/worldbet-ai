'use strict';

/** Cuotas live desde Supabase match_odds + Realtime */
class OddsLiveManager {
  constructor(app) {
    this.app = app;
    this.odds = {};
    this.deltas = {};
    this.lastUpdated = null;
    this.channel = null;
    this.pollTimer = null;
  }

  get client() { return SupabaseClient.getClient(); }

  async init() {
    if (!this.client) return;
    await this.loadAll();
    this.subscribeRealtime();
    this.pollTimer = setInterval(() => this.loadAll(), 60000);
  }

  async loadAll() {
    if (!this.client) return;
    const { data } = await this.client.from('match_odds').select('*');
    if (!data) return;
    data.forEach((row) => this.applyRow(row, false));
    this.updateBadge();
  }

  subscribeRealtime() {
    if (!this.client || this.channel) return;
    this.channel = this.client
      .channel('match_odds_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_odds' }, (payload) => {
        const row = payload.new || payload.old;
        if (row?.match_id) this.applyRow(row, true);
        this.updateBadge();
        if (this.app?.currentView) this.app.refreshOddsUI();
      })
      .subscribe();
  }

  applyRow(row, animate) {
    const prev = this.odds[row.match_id];
    const next = {
      home: Number(row.home_odds),
      draw: Number(row.draw_odds),
      away: Number(row.away_odds),
      over25: row.over25_odds != null ? Number(row.over25_odds) : null,
      under25: row.under25_odds != null ? Number(row.under25_odds) : null,
      bookmaker: row.bookmaker,
      updatedAt: row.updated_at
    };
    if (animate && prev) {
      this.deltas[row.match_id] = {
        home: this.dir(prev.home, next.home),
        draw: this.dir(prev.draw, next.draw),
        away: this.dir(prev.away, next.away)
      };
      setTimeout(() => { delete this.deltas[row.match_id]; }, 1600);
    }
    this.odds[row.match_id] = next;
    if (row.updated_at) this.lastUpdated = row.updated_at;
  }

  dir(oldV, newV) {
    if (oldV == null || newV == null || oldV === newV) return 'same';
    return newV > oldV ? 'up' : 'down';
  }

  has(matchId) { return !!this.odds[matchId]?.home; }

  get(matchId) { return this.odds[matchId] || null; }

  getDelta(matchId) { return this.deltas[matchId] || {}; }

  applyToMatchData(matchId, data) {
    const o = this.get(matchId);
    if (!o) return data;
    if (o.home) data.marketHomeOdds = o.home;
    if (o.draw) data.marketDrawOdds = o.draw;
    if (o.away) data.marketAwayOdds = o.away;
    if (o.over25) data.over25Odds = o.over25;
    if (o.under25) data.under25Odds = o.under25;
    const bmName = o.bookmaker || 'Mercado live';
    data.bookmakers = data.bookmakers || {};
    data.bookmakers[bmName] = { home: o.home, draw: o.draw, away: o.away };
    if (data.lineMovement) data.lineMovement.current = o.home;
    if (!data.dataSources.includes('Cuotas live (servidor)')) {
      data.dataSources.push('Cuotas live (servidor)');
    }
    return data;
  }

  minutesAgo() {
    if (!this.lastUpdated) return null;
    return Math.max(0, Math.floor((Date.now() - new Date(this.lastUpdated)) / 60000));
  }

  updateBadge() {
    const el = document.getElementById('odds-live-badge');
    if (!el) return;
    const mins = this.minutesAgo();
    if (mins == null || !Object.keys(this.odds).length) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';
    el.querySelector('.odds-live-label').textContent = mins < 1 ? 'Cuotas · ahora' : `Cuotas · hace ${mins} min`;
  }

  chipClass(matchId, field) {
    const d = this.getDelta(matchId)[field];
    if (d === 'up') return 'odds-flash-up';
    if (d === 'down') return 'odds-flash-down';
    return '';
  }

  arrow(matchId, field) {
    const d = this.getDelta(matchId)[field];
    if (d === 'up') return '<span class="odds-arrow">↑</span>';
    if (d === 'down') return '<span class="odds-arrow">↓</span>';
    return '';
  }
}
