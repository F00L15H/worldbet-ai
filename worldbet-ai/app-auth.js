'use strict';

/** Autenticación email/contraseña y perfil de usuario */
class AuthManager {
  constructor(app) {
    this.app = app;
    this.user = null;
    this.profile = null;
    this.listeners = [];
  }

  onChange(fn) { this.listeners.push(fn); }
  _notify() { this.listeners.forEach(fn => fn(this.user, this.profile)); }

  get isLoggedIn() { return !!this.user; }

  async init() {
    const client = SupabaseClient.getClient();
    if (!client) return;
    // Procesa el enlace de confirmación de email (?code=... en la URL)
    if (window.location.search.includes('code=') || window.location.hash.includes('access_token')) {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      if (code) await client.auth.exchangeCodeForSession(code).catch(() => {});
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    const { data: { session } } = await client.auth.getSession();
    if (session?.user) {
      this.user = session.user;
      await this.loadProfile();
    }
    client.auth.onAuthStateChange(async (_event, session) => {
      this.user = session?.user ?? null;
      if (this.user) await this.loadProfile();
      else this.profile = null;
      this._notify();
      if (this.app) this.app.onAuthChange();
    });
  }

  async loadProfile() {
    const client = SupabaseClient.getClient();
    if (!client || !this.user) return null;
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', this.user.id)
      .single();
    if (!error && data) {
      this.profile = data;
      if (this.app?.config) {
        this.app.config.bankroll = parseFloat(data.bankroll) || 10000;
        if (this.app.updateBankrollDisplay) this.app.updateBankrollDisplay();
      }
    }
    return this.profile;
  }

  async signUp(email, password, displayName) {
    const client = SupabaseClient.getClient();
    if (!client) throw new Error('Backend no configurado. Añade SUPABASE_URL y SUPABASE_ANON_KEY.');
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split('@')[0] },
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) throw error;
    return data;
  }

  async signIn(email, password) {
    const client = SupabaseClient.getClient();
    if (!client) throw new Error('Backend no configurado');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.user = data.user;
    await this.loadProfile();
    this._notify();
    return data;
  }

  async signOut() {
    const client = SupabaseClient.getClient();
    if (!client) return;
    await client.auth.signOut();
    this.user = null;
    this.profile = null;
    this._notify();
  }

  async updateBankroll(amount) {
    const client = SupabaseClient.getClient();
    if (!client || !this.user) return;
    const { error } = await client
      .from('profiles')
      .update({ bankroll: amount })
      .eq('id', this.user.id);
    if (!error && this.profile) this.profile.bankroll = amount;
  }

  displayName() {
    return this.profile?.display_name || this.user?.email?.split('@')[0] || 'Usuario';
  }
}
