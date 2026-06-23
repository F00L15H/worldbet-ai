'use strict';

/** Cliente Supabase — requiere window.SUPABASE_CONFIG { url, anonKey } */
const SupabaseClient = {
  _client: null,

  isConfigured() {
    const cfg = window.SUPABASE_CONFIG;
    return !!(cfg?.url && cfg?.anonKey && !cfg.url.includes('YOUR_PROJECT'));
  },

  getClient() {
    if (!this.isConfigured()) return null;
    if (!this._client && typeof supabase !== 'undefined') {
      this._client = supabase.createClient(
        window.SUPABASE_CONFIG.url,
        window.SUPABASE_CONFIG.anonKey,
        {
          auth: {
            detectSessionInUrl: true,
            persistSession: true,
            flowType: 'pkce'
          }
        }
      );
    }
    return this._client;
  },

  async invokeFunction(name, body = {}) {
    const client = this.getClient();
    if (!client) return { ok: false, error: 'Supabase no configurado' };
    try {
      const { data, error } = await client.functions.invoke(name, { body });
      if (error) return { ok: false, error: error.message };
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async invokeTheStats(action, params = {}) {
    return this.invokeFunction('thestats-api', { action, ...params });
  }
};
