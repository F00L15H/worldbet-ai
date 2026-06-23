'use strict';

/** Apuestas virtuales, snapshots y sync con Supabase */
class BetsManager {
  constructor(app) {
    this.app = app;
    this.userBets = [];
    this.snapshots = {};
  }

  get client() { return SupabaseClient.getClient(); }

  async syncMatchesFromServer() {
    return SupabaseClient.invokeFunction('sync-matches');
  }

  async upsertMatches(fixtures) {
    const client = this.client;
    if (!client || !fixtures?.length) return;
    const rows = fixtures.map(f => ({
      id: f.id,
      match_number: f.matchNumber,
      home_team: f.homeTeam,
      away_team: f.awayTeam,
      kickoff_utc: f.kickoffUtc,
      match_date: f.date,
      stage: f.stage,
      group_name: f.group || null,
      stadium: f.stadium || '',
      host_city: f.hostCity || '',
      status: f.status || 'scheduled',
      home_score: f.homeScore ?? null,
      away_score: f.awayScore ?? null,
      is_placeholder: f.isPlaceholder || false,
      synced_at: new Date().toISOString()
    }));
    await client.from('matches').upsert(rows, { onConflict: 'id' });
  }

  async loadDbMatches() {
    const client = this.client;
    if (!client) return [];
    const { data } = await client.from('matches').select('*').order('kickoff_utc');
    return data || [];
  }

  mergeDbStatusIntoFixtures(fixtures, dbMatches) {
    if (!dbMatches?.length) return fixtures;
    const map = Object.fromEntries(dbMatches.map(m => [m.id, m]));
    return fixtures.map(f => {
      const db = map[f.id];
      if (!db) return f;
      return {
        ...f,
        status: db.status || f.status,
        homeScore: db.home_score,
        awayScore: db.away_score
      };
    });
  }

  async saveSnapshot(matchId, recommendation, dataSources) {
    const client = this.client;
    if (!client || !recommendation) return null;
    const existing = this.snapshots[matchId];
    if (existing?.computed_at) {
      const age = Date.now() - new Date(existing.computed_at).getTime();
      if (age < 60 * 60 * 1000) return existing.id;
    }
    const { data, error } = await client
      .from('prediction_snapshots')
      .insert({
        match_id: matchId,
        recommendation,
        data_sources: dataSources || []
      })
      .select('id')
      .single();
    if (!error && data) {
      this.snapshots[matchId] = { id: data.id, recommendation, computed_at: new Date().toISOString() };
      return data.id;
    }
    return null;
  }

  async loadSnapshotsForMatches(matchIds) {
    const client = this.client;
    if (!client || !matchIds?.length) return;
    const { data } = await client
      .from('prediction_snapshots')
      .select('id, match_id, recommendation, data_sources, computed_at')
      .in('match_id', matchIds)
      .order('computed_at', { ascending: false });
    if (!data) return;
    data.forEach(s => {
      if (!this.snapshots[s.match_id]) {
        this.snapshots[s.match_id] = s;
      }
    });
  }

  async loadLatestSnapshots(limit = 50) {
    const client = this.client;
    if (!client) return [];
    const { data } = await client
      .from('prediction_snapshots')
      .select('id, match_id, recommendation, data_sources, computed_at, matches(home_team, away_team, status, home_score, away_score, kickoff_utc)')
      .order('computed_at', { ascending: false })
      .limit(limit);
    return data || [];
  }

  async loadUserBets() {
    const client = this.client;
    if (!client || !this.app.auth?.user) return [];
    const { data, error } = await client
      .from('user_bets')
      .select('*, matches(home_team, away_team, kickoff_utc, status, home_score, away_score)')
      .order('placed_at', { ascending: false });
    if (error) {
      console.warn('loadUserBets', error);
      return [];
    }
    this.userBets = data || [];
    return this.userBets;
  }

  async placeBet({ matchId, marketType, marketLabel, odds, stake, snapshotId }) {
    const client = this.client;
    if (!client) throw new Error('Backend no configurado');
    if (!this.app.auth?.isLoggedIn) throw new Error('Debes iniciar sesión para guardar apuestas');

    const fixture = this.app.fixtures.find(f => f.id === matchId);
    if (fixture && new Date(fixture.kickoffUtc) <= new Date()) {
      throw new Error('El partido ya empezó');
    }

    const { data, error } = await client.rpc('place_user_bet', {
      p_match_id: matchId,
      p_market_type: marketType,
      p_market_label: marketLabel,
      p_odds: odds,
      p_stake: stake,
      p_snapshot_id: snapshotId || null
    });
    if (error) throw new Error(error.message);

    await this.app.auth.loadProfile();
    await this.loadUserBets();
    return data;
  }

  getUserBetMatchIds() {
    return [...new Set(this.userBets.map(b => b.match_id))];
  }

  getStats() {
    const bets = this.userBets;
    const settled = bets.filter(b => b.status === 'won' || b.status === 'lost');
    const won = bets.filter(b => b.status === 'won');
    const lost = bets.filter(b => b.status === 'lost');
    const pending = bets.filter(b => b.status === 'pending');
    const totalStaked = settled.reduce((s, b) => s + parseFloat(b.stake), 0);
    const totalReturn = won.reduce((s, b) => s + parseFloat(b.stake) + parseFloat(b.payout || 0), 0);
    const roi = totalStaked > 0 ? ((totalReturn - totalStaked) / totalStaked) * 100 : 0;
    return { won: won.length, lost: lost.length, pending: pending.length, roi, totalStaked };
  }

  statusLabel(status) {
    return { pending: 'Pendiente', won: 'Ganada', lost: 'Perdida', void: 'Anulada' }[status] || status;
  }

  statusClass(status) {
    return { pending: 'value-med', won: 'value-high', lost: 'value-low', void: '' }[status] || '';
  }
}
