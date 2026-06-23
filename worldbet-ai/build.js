const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dir = __dirname;

function loadEnv() {
  const envPath = path.join(dir, '..', '.env');
  const vars = {};
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const m = trimmed.match(/^([^=]+)=(.*)$/);
      if (m) vars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    });
  }
  let supabaseUrl = process.env.SUPABASE_URL || vars.SUPABASE_URL || '';
  let supabaseAnonKey = process.env.SUPABASE_ANON_KEY || vars.SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !supabaseAnonKey) {
    const cfgPath = path.join(dir, 'supabase.config.json');
    if (fs.existsSync(cfgPath)) {
      try {
        const file = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        supabaseUrl = supabaseUrl || file.url || '';
        supabaseAnonKey = supabaseAnonKey || file.anonKey || '';
      } catch (e) {
        console.warn('No se pudo leer supabase.config.json:', e.message);
      }
    }
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('AVISO: Supabase no configurado. Añade SUPABASE_URL y SUPABASE_ANON_KEY en .env o supabase.config.json');
  }
  return {
    supabaseUrl,
    supabaseAnonKey,
    thestatsapiKey: process.env.THESTATSAPI_KEY || vars.THESTATSAPI_KEY || '',
    oddsApiKey: process.env.ODDS_API_KEY || vars.ODDS_API_KEY || '',
    apifootballKey: process.env.APIFOOTBALL_KEY || vars.APIFOOTBALL_KEY || '',
    worldcupApiKey: process.env.WORLDCUP_API_KEY || vars.WORLDCUP_API_KEY || ''
  };
}

const env = loadEnv();
const core = fs.readFileSync(path.join(dir, 'app-core.js'), 'utf8');
const supabaseJs = fs.readFileSync(path.join(dir, 'app-supabase.js'), 'utf8');
const authJs = fs.readFileSync(path.join(dir, 'app-auth.js'), 'utf8');
const betsJs = fs.readFileSync(path.join(dir, 'app-bets.js'), 'utf8');
const oddsLiveJs = fs.readFileSync(path.join(dir, 'app-odds-live.js'), 'utf8');
const wb = fs.readFileSync(path.join(dir, 'app-worldbet.js'), 'utf8');
const mobilePwaCss = fs.readFileSync(path.join(dir, 'mobile-pwa.css'), 'utf8');

const configScript = `window.SUPABASE_CONFIG = ${JSON.stringify({ url: env.supabaseUrl, anonKey: env.supabaseAnonKey })};\nwindow.API_KEYS = ${JSON.stringify({
  thestatsapi: env.thestatsapiKey,
  apifootball: env.apifootballKey,
  worldcup: env.worldcupApiKey
})};`;
const shell = `<!DOCTYPE html>
<html lang="es" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="WorldBet">
  <meta name="theme-color" content="#0d0f14">
  <meta name="mobile-web-app-capable" content="yes">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <title>WorldBet AI — Predicciones Mundial 2026</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&family=Inter:wght@300..700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/countup.js/2.8.0/countUp.umd.js"></script>
  <style>
    :root {
      --color-bg: #0d0f14; --color-surface: #131720; --color-surface-2: #181d2a;
      --color-surface-offset: #1e2436; --color-surface-dynamic: #252c42;
      --color-divider: #2a3148; --color-border: #303a55;
      --color-text: #e8eaf0; --color-text-muted: #8892aa; --color-text-faint: #4a5470;
      --color-text-inverse: #0d0f14;
      --color-primary: #00c853; --color-primary-hover: #00a846; --color-primary-active: #008838;
      --color-primary-highlight: #0d2a1a;
      --color-gold: #ffd700; --color-gold-hover: #e6c200; --color-gold-highlight: #2a2200;
      --color-success: #00c853; --color-warning: #ff9800; --color-error: #f44336; --color-info: #2196f3;
      --color-value-high: #00c853; --color-value-med: #ff9800; --color-value-low: #f44336;
      --text-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);
      --text-sm: clamp(0.875rem, 0.8rem + 0.35vw, 1rem);
      --text-base: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
      --text-lg: clamp(1.125rem, 1rem + 0.75vw, 1.5rem);
      --text-xl: clamp(1.5rem, 1.2rem + 1.25vw, 2.25rem);
      --text-2xl: clamp(2rem, 1.2rem + 2.5vw, 3.5rem);
      --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
      --space-6: 1.5rem; --space-8: 2rem; --space-10: 2.5rem; --space-12: 3rem; --space-16: 4rem;
      --radius-sm: 0.375rem; --radius-md: 0.5rem; --radius-lg: 0.75rem; --radius-xl: 1rem; --radius-full: 9999px;
      --font-display: 'Oswald', 'Arial Narrow', sans-serif;
      --font-body: 'Inter', 'Segoe UI', sans-serif;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.4); --shadow-md: 0 4px 16px rgba(0,0,0,0.5);
      --shadow-lg: 0 12px 40px rgba(0,0,0,0.6); --shadow-glow: 0 0 20px rgba(0,200,83,0.2);
      --transition-interactive: 180ms cubic-bezier(0.16, 1, 0.3, 1);
      --content-default: 1200px; --content-wide: 1400px;
      --sidebar-w: 240px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { font-family: var(--font-body); font-size: var(--text-base); color: var(--color-text); background: var(--color-bg); line-height: 1.5; min-height: 100vh; }
    h1,h2,h3,h4 { font-family: var(--font-display); font-weight: 600; letter-spacing: 0.02em; }
    button, input, select, textarea { font-family: inherit; font-size: inherit; }
    button { cursor: pointer; border: none; background: none; min-height: 44px; }
    input[type="number"]::-webkit-inner-spin-button,
    input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
    a { color: var(--color-primary); }
    img { max-width: 100%; display: block; }
    .app { display: flex; flex-direction: column; min-height: 100vh; }
    .header { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-3) var(--space-6); background: var(--color-surface); border-bottom: 1px solid var(--color-border); position: sticky; top: 0; z-index: 100; }
    .logo { display: flex; align-items: center; gap: var(--space-3); text-decoration: none; color: inherit; }
    .logo-text { font-family: var(--font-display); font-size: var(--text-lg); font-weight: 700; }
    .logo-text span { color: var(--color-primary); }
    .header-actions { display: flex; align-items: center; gap: var(--space-3); margin-left: auto; }
    .api-status { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); color: var(--color-text-muted); padding: var(--space-1) var(--space-2); border-radius: var(--radius-md); border: 1px solid transparent; transition: var(--transition-interactive); cursor: default; }
    .api-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--color-text-faint); flex-shrink: 0; transition: var(--transition-interactive); }
    .api-dot.ok { background: var(--color-success); box-shadow: 0 0 6px rgba(0,200,83,0.5); }
    .api-dot.gold { background: var(--color-gold); box-shadow: 0 0 10px rgba(255,215,0,0.7); animation: trustGlow 2s ease-in-out infinite; }
    .api-dot.err { background: var(--color-error); box-shadow: 0 0 6px rgba(244,67,54,0.4); }
    .api-dot.pending { background: var(--color-warning); animation: pulse 1.2s ease-in-out infinite; }
    .api-status.verified { color: var(--color-gold); border-color: rgba(255,215,0,0.35); background: var(--color-gold-highlight); font-weight: 600; }
    .api-status.failed { color: var(--color-error); border-color: rgba(244,67,54,0.3); background: rgba(244,67,54,0.08); }
    .api-status.unverified { color: var(--color-warning); border-color: rgba(255,152,0,0.25); }
    @keyframes trustGlow { 0%, 100% { box-shadow: 0 0 8px rgba(255,215,0,0.5); } 50% { box-shadow: 0 0 14px rgba(255,215,0,0.9); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
    .bankroll-input { width: 90px; padding: var(--space-2); background: var(--color-surface-offset); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text); }
    .bankroll-chip {
      display: inline-flex; align-items: center; padding: var(--space-1) var(--space-2);
      background: var(--color-gold-highlight); border: 1px solid rgba(255,215,0,0.35);
      border-radius: var(--radius-full); font-family: var(--font-display); font-size: var(--text-sm);
      font-weight: 600; color: var(--color-gold); white-space: nowrap; user-select: none;
    }
    .icon-btn { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: var(--radius-md); color: var(--color-text-muted); transition: var(--transition-interactive); }
    .icon-btn:hover { background: var(--color-surface-offset); color: var(--color-text); }
    .hamburger { display: none; }
    .layout { display: flex; flex: 1; }
    .sidebar { width: var(--sidebar-w); background: var(--color-surface); border-right: 1px solid var(--color-border); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-1); position: sticky; top: 60px; height: calc(100vh - 60px); overflow-y: auto; }
    .nav-item { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); color: var(--color-text-muted); font-size: var(--text-sm); transition: var(--transition-interactive); text-align: left; width: 100%; }
    .nav-item:hover { background: var(--color-surface-offset); color: var(--color-text); }
    .nav-item.active { background: var(--color-primary-highlight); color: var(--color-primary); font-weight: 600; }
    .main { flex: 1; padding: var(--space-6); max-width: var(--content-wide); overflow-x: hidden; }
    .footer-bar { padding: var(--space-2) var(--space-6); background: var(--color-surface); border-top: 1px solid var(--color-border); font-size: var(--text-xs); color: var(--color-text-muted); display: flex; justify-content: space-between; }
    .view-title { font-size: var(--text-xl); margin-bottom: var(--space-6); }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-4); margin-bottom: var(--space-6); }
    .kpi-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4); box-shadow: var(--shadow-sm); }
    .kpi-label { font-size: var(--text-xs); color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .kpi-value { font-family: var(--font-display); font-size: var(--text-2xl); color: var(--color-primary); margin-top: var(--space-2); }
    .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4); box-shadow: var(--shadow-sm); margin-bottom: var(--space-4); }
    .card-title { font-size: var(--text-lg); margin-bottom: var(--space-4); }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--space-4); }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); font-weight: 600; font-size: var(--text-sm); transition: var(--transition-interactive); min-height: 44px; }
    .btn-primary { background: var(--color-primary); color: var(--color-text-inverse); }
    .btn-primary:hover { background: var(--color-primary-hover); }
    .btn-outline { border: 1px solid var(--color-border); color: var(--color-text); background: transparent; }
    .btn-outline:hover { background: var(--color-surface-offset); }
    .btn-sm { min-height: 36px; padding: var(--space-2) var(--space-3); font-size: var(--text-xs); }
    .auth-tabs { display: flex; gap: var(--space-2); margin-bottom: var(--space-4); }
    .auth-tab { flex: 1; padding: var(--space-2); border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface-offset); color: var(--color-text-muted); font-weight: 600; min-height: 40px; }
    .auth-tab.active { background: var(--color-primary-highlight); color: var(--color-primary); border-color: var(--color-primary); }
    #auth-header { display: flex; align-items: center; gap: var(--space-2); }
    .filters { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-4); }
    .filters select, .filters input { padding: var(--space-2) var(--space-3); background: var(--color-surface-offset); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text); min-height: 44px; }
    .match-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-4); }
    .match-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4); transition: var(--transition-interactive); content-visibility: auto; }
    .match-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-glow); }
    .match-teams { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-bottom: var(--space-3); }
    .team { display: flex; align-items: center; gap: var(--space-2); font-weight: 600; font-size: var(--text-sm); }
    .team img { width: 28px; height: 20px; object-fit: cover; border-radius: 2px; }
    .vs { color: var(--color-text-faint); font-size: var(--text-xs); }
    .match-meta { font-size: var(--text-xs); color: var(--color-text-muted); margin-bottom: var(--space-3); }
    .badge { display: inline-block; padding: 2px 8px; border-radius: var(--radius-full); font-size: var(--text-xs); font-weight: 600; }
    .badge-group { background: var(--color-primary-highlight); color: var(--color-primary); }
    .badge-tbd { background: var(--color-surface-dynamic); color: var(--color-text-muted); }
    .badge-value { background: var(--color-gold-highlight); color: var(--color-gold); }
    .rec-box { border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); margin: var(--space-3) 0; border: 1px solid var(--color-border); }
    .rec-box-value { background: linear-gradient(135deg, var(--color-gold-highlight), var(--color-surface-offset)); border-color: var(--color-gold); }
    .rec-box-model { background: var(--color-primary-highlight); border-color: var(--color-primary); }
    .rec-box-culebra { background: linear-gradient(135deg, #1a1530, var(--color-surface-offset)); border-color: #9c27b0; }
    .rec-picks { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--color-divider); }
    .rec-pick-row { display: flex; justify-content: space-between; gap: var(--space-2); font-size: var(--text-sm); padding: var(--space-2) 0; border-bottom: 1px solid var(--color-divider); }
    .rec-pick-row:last-child { border-bottom: none; }
    .rec-conf { font-size: var(--text-xs); font-weight: 600; }
    .rec-conf-alta { color: var(--color-success); }
    .rec-conf-media { color: var(--color-warning); }
    .rec-conf-culebra { color: #ce93d8; }
    .rec-box.compact { padding: var(--space-2) var(--space-3); font-size: var(--text-sm); }
    .rec-label { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); margin-bottom: var(--space-2); font-weight: 600; }
    .rec-primary { font-size: var(--text-base); font-weight: 600; margin-bottom: var(--space-2); }
    .rec-detail { font-size: var(--text-xs); color: var(--color-text-muted); }
    .rec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--space-3); margin: var(--space-3) 0; font-size: var(--text-sm); }
    .rec-k { font-size: var(--text-xs); color: var(--color-text-muted); text-transform: uppercase; }
    .rec-sources { font-size: var(--text-xs); color: var(--color-text-faint); margin-top: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--color-divider); }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
    th, td { padding: var(--space-3); text-align: left; border-bottom: 1px solid var(--color-divider); }
    th { color: var(--color-text-muted); font-weight: 600; font-size: var(--text-xs); text-transform: uppercase; }
    tr:hover td { background: var(--color-surface-offset); }
    .value-high { color: var(--color-value-high); font-weight: 700; }
    .value-med { color: var(--color-value-med); font-weight: 600; }
    .value-low { color: var(--color-value-low); }
    .skeleton { background: linear-gradient(90deg, var(--color-surface-offset) 25%, var(--color-surface-dynamic) 50%, var(--color-surface-offset) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: var(--radius-md); min-height: 80px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .empty-state, .error-state { text-align: center; padding: var(--space-12); color: var(--color-text-muted); }
    .error-state { color: var(--color-error); }
    .empty-icon { font-size: 3rem; margin-bottom: var(--space-4); }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 200; display: flex; align-items: flex-start; justify-content: center; padding: var(--space-4); overflow-y: auto; }
    .modal { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-xl); width: 100%; max-width: 900px; margin: var(--space-4) auto; box-shadow: var(--shadow-lg); }
    .modal-header { display: flex; align-items: center; justify-content: space-between; padding: var(--space-4) var(--space-6); border-bottom: 1px solid var(--color-divider); }
    .modal-body { padding: var(--space-6); }
    .prob-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); text-align: center; margin: var(--space-4) 0; }
    .prob-cell { background: var(--color-surface-offset); border-radius: var(--radius-md); padding: var(--space-3); }
    .prob-cell .pct { font-family: var(--font-display); font-size: var(--text-xl); color: var(--color-primary); }
    .chart-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: var(--space-4); margin: var(--space-4) 0; }
    .chart-box { background: var(--color-surface-offset); border-radius: var(--radius-md); padding: var(--space-3); }
    .chart-box canvas { max-height: 200px; }
    .heatmap-cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 9px; border-radius: 2px; color: var(--color-text-inverse); }
    .stat-bar { margin: var(--space-2) 0; }
    .stat-bar-label { display: flex; justify-content: space-between; font-size: var(--text-xs); margin-bottom: 4px; }
    .stat-bar-track { height: 8px; background: var(--color-surface-dynamic); border-radius: var(--radius-full); overflow: hidden; }
    .stat-bar-fill { height: 100%; background: var(--color-primary); border-radius: var(--radius-full); }
    .form-dots { display: flex; gap: 4px; }
    .form-dot { width: 12px; height: 12px; border-radius: 50%; }
    .form-dot.W { background: var(--color-success); }
    .form-dot.D { background: var(--color-warning); }
    .form-dot.L { background: var(--color-error); }
    .countdown { font-family: var(--font-display); font-size: var(--text-2xl); color: var(--color-gold); }
    .settings-form { max-width: 600px; }
    .form-group { margin-bottom: var(--space-4); }
    .form-group label { display: block; font-size: var(--text-sm); color: var(--color-text-muted); margin-bottom: var(--space-2); }
    .form-group input, .form-group select, .form-group textarea { width: 100%; padding: var(--space-3); background: var(--color-surface-offset); border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text); }
    .form-group textarea { min-height: 100px; resize: vertical; }
    .ai-response { background: var(--color-surface-offset); border-radius: var(--radius-md); padding: var(--space-4); margin-top: var(--space-4); }
    .ai-history-item { padding: var(--space-3); border-bottom: 1px solid var(--color-divider); font-size: var(--text-sm); }
    .toast { position: fixed; bottom: var(--space-6); right: var(--space-6); background: var(--color-primary); color: var(--color-text-inverse); padding: var(--space-3) var(--space-6); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); z-index: 300; animation: slideUp 0.3s ease; }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .sidebar-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 90; }
    @media (max-width: 768px) {
      .hamburger { display: flex; }
      .sidebar { position: fixed; left: -280px; top: 0; height: 100vh; z-index: 95; transition: left 0.3s ease; padding-top: 70px; }
      .sidebar.open { left: 0; }
      .sidebar-overlay.open { display: block; }
      .main { padding: var(--space-4); }
      .header { padding: var(--space-3) var(--space-4); }
      .prob-grid { grid-template-columns: 1fr; }
    }
${mobilePwaCss}
  </style>
</head>
<body>
  <div class="app" id="app">
    <header class="header" role="banner">
      <button class="icon-btn hamburger" id="btn-hamburger" aria-label="Abrir menú de navegación"><i data-lucide="menu"></i></button>
      <a href="#" class="logo" id="logo-link" aria-label="WorldBet AI inicio">
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="18" fill="none" stroke="#00c853" stroke-width="2"/>
          <path d="M20 4 C20 4 8 12 8 20 C8 28 20 36 20 36 C20 36 32 28 32 20 C32 12 20 4 20 4Z" fill="none" stroke="#00c853" stroke-width="1.5"/>
          <path d="M8 20 H32 M20 4 V36 M12 10 L28 30 M28 10 L12 30" stroke="#00c853" stroke-width="1" opacity="0.6"/>
          <circle cx="20" cy="20" r="6" fill="#ffd700" opacity="0.9"/>
        </svg>
        <span class="logo-text">World<span>Bet</span> AI</span>
      </a>
      <div class="header-actions">
        <div class="odds-live-badge" id="odds-live-badge" style="display:none" title="Cuotas sincronizadas desde el servidor">
          <span class="odds-live-dot" aria-hidden="true"></span>
          <span class="odds-live-label">Cuotas</span>
        </div>
        <div class="api-status" id="api-status" role="status" aria-live="polite" title="Estado de verificación de APIs">
          <span class="api-dot" id="api-dot" aria-hidden="true"></span>
          <span id="api-status-text">DEMO</span>
        </div>
        <div id="auth-header"></div>
        <span class="bankroll-chip" id="bankroll-quick" aria-label="Bankroll virtual">€10.000</span>
      </div>
    </header>
    <div class="layout">
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <aside class="sidebar" id="sidebar" role="navigation" aria-label="Navegación principal">
        <button class="nav-item active" data-view="dashboard"><i data-lucide="layout-dashboard"></i> Dashboard</button>
        <button class="nav-item" data-view="today"><i data-lucide="calendar"></i> Partidos Hoy</button>
        <button class="nav-item" data-view="groups"><i data-lucide="users"></i> Fase Grupos</button>
        <button class="nav-item" data-view="knockout"><i data-lucide="trophy"></i> Eliminatorias</button>
        <button class="nav-item" data-view="valuebets"><i data-lucide="trending-up"></i> Apuestas</button>
        <button class="nav-item" data-view="mybets"><i data-lucide="wallet"></i> Mis Apuestas</button>
        <button class="nav-item" data-view="history"><i data-lucide="history"></i> Historial</button>
        <button class="nav-item" data-view="ai"><i data-lucide="brain"></i> Análisis IA</button>
        <button class="nav-item" data-view="settings"><i data-lucide="settings"></i> Configuración</button>
      </aside>
      <main class="main" id="main-content" role="main"><div class="skeleton" style="height:200px"></div></main>
    </div>
    <footer class="footer-bar" role="contentinfo">
      <span id="footer-update">Cargando...</span>
      <span id="footer-mode">Modo: DEMO</span>
    </footer>
    <nav class="bottom-nav" id="bottom-nav" aria-label="Navegación móvil">
      <button type="button" class="bottom-nav-item active" data-view="dashboard" data-bottom-nav><i data-lucide="home"></i><span>Inicio</span></button>
      <button type="button" class="bottom-nav-item" data-view="today" data-bottom-nav><i data-lucide="calendar"></i><span>Partidos</span></button>
      <button type="button" class="bottom-nav-item" data-view="valuebets" data-bottom-nav><i data-lucide="trending-up"></i><span>Apuestas</span></button>
      <button type="button" class="bottom-nav-item" data-view="settings" data-bottom-nav><i data-lucide="user"></i><span>Perfil</span></button>
    </nav>
  </div>
  <div id="install-banner-root"></div>
  <div id="modal-root"></div>
  <div id="toast-root"></div>
  <script>
${configScript}
${core}
${supabaseJs}
${authJs}
${betsJs}
${oddsLiveJs}
${wb}
  </script>
</body>
</html>`;
fs.writeFileSync(path.join(dir, 'worldbet-ai.html'), shell);
fs.writeFileSync(path.join(dir, 'index.html'), shell);

const iconsDir = path.join(dir, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });
try {
  execSync('python scripts/generate-icons.py', { cwd: dir, stdio: 'inherit' });
} catch (e) {
  console.warn('Icon PNG generation skipped:', e.message);
}

const manifest = {
  name: 'WorldBet AI',
  short_name: 'WorldBet',
  description: 'Predicciones y apuestas Mundial 2026',
  start_url: '/',
  display: 'standalone',
  background_color: '#0d0f14',
  theme_color: '#0d0f14',
  orientation: 'portrait-primary',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
  ]
};
fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

const lines = shell.split('\n').length;
console.log('Built worldbet-ai.html + index.html with', lines, 'lines');
console.log('Wrote manifest.webmanifest and PWA icons');
