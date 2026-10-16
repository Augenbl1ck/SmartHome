/** Persönliche App-Einstellungen. Nur die Android-App, nicht der Pi. */

export type AppTheme = 'light' | 'dark' | 'system';

export type PersonalProfile = {
  ready: true;
  pin_hash: string | null;
  pin_enabled: boolean;
  lock_timeout: number;
  theme: AppTheme;
  dashboard_layout: unknown;
};

type PanelSlice = {
  pin_hash?: string | null;
  pin_enabled?: boolean;
  lock_timeout?: number;
  theme?: AppTheme | null;
  dashboard_layout?: unknown;
};

type AddressBridge = {
  getPersonal?: () => string;
  setPersonal?: (value: string) => void;
};

const PIN_HASH = 'smarthome_pin_hash';
const PIN_ENABLED = 'smarthome_pin_enabled';
const LOCK_TIMEOUT = 'smarthome_lock_timeout';
const THEME = 'smarthome_theme';
const DASHBOARD = 'smarthome_dashboard_layout';

let boot: Promise<boolean> | null = null;

export function isAndroidApp(): boolean {
  return typeof navigator !== 'undefined' && /SmartHomeAndroid\//.test(navigator.userAgent);
}

function bridge(): AddressBridge | null {
  if (typeof window === 'undefined') return null;
  const value = (window as Window & { SmartHomeAddress?: AddressBridge }).SmartHomeAddress;
  return value?.getPersonal && value?.setPersonal ? value : null;
}

export function readProfile(): PersonalProfile | null {
  const store = bridge();
  if (!store?.getPersonal) return null;
  try {
    const raw = store.getPersonal();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersonalProfile;
    if (!parsed || parsed.ready !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeProfile(profile: PersonalProfile) {
  bridge()?.setPersonal?.(JSON.stringify(profile));
}

function applyProfileToPage(profile: PersonalProfile) {
  if (profile.pin_hash) localStorage.setItem(PIN_HASH, JSON.stringify(profile.pin_hash));
  else localStorage.removeItem(PIN_HASH);
  localStorage.setItem(PIN_ENABLED, JSON.stringify(!!profile.pin_enabled));
  localStorage.setItem(LOCK_TIMEOUT, JSON.stringify(profile.lock_timeout ?? 30));
  localStorage.setItem(THEME, profile.theme || 'system');
  if (profile.dashboard_layout && typeof profile.dashboard_layout === 'object') {
    localStorage.setItem(DASHBOARD, JSON.stringify(profile.dashboard_layout));
  }
}

/** Vor React: gespeichertes Profil in den Seitenspeicher legen, damit PIN und Darstellung nicht flackern. */
export function hydratePersonalScript(): string {
  return `(function(){
    try {
      if (!/SmartHomeAndroid\\//.test(navigator.userAgent)) return;
      var b = window.SmartHomeAddress;
      if (!b || !b.getPersonal) return;
      var raw = b.getPersonal();
      if (!raw) return;
      var p = JSON.parse(raw);
      if (!p || p.ready !== true) return;
      if (p.pin_hash) localStorage.setItem('smarthome_pin_hash', JSON.stringify(p.pin_hash));
      else localStorage.removeItem('smarthome_pin_hash');
      localStorage.setItem('smarthome_pin_enabled', JSON.stringify(!!p.pin_enabled));
      localStorage.setItem('smarthome_lock_timeout', JSON.stringify(typeof p.lock_timeout === 'number' ? p.lock_timeout : 30));
      if (p.theme) localStorage.setItem('smarthome_theme', p.theme);
      if (p.dashboard_layout && typeof p.dashboard_layout === 'object') {
        localStorage.setItem('smarthome_dashboard_layout', JSON.stringify(p.dashboard_layout));
      }
    } catch (e) {}
  })();`;
}

function snapshotFromPage(base: PersonalProfile | null): PersonalProfile {
  let pinHash: string | null = null;
  try {
    const raw = localStorage.getItem(PIN_HASH);
    pinHash = raw ? JSON.parse(raw) as string : null;
  } catch { pinHash = null; }
  let enabled = false;
  try { enabled = JSON.parse(localStorage.getItem(PIN_ENABLED) || 'false') === true; } catch { enabled = false; }
  let lockTimeout = 30;
  try { lockTimeout = JSON.parse(localStorage.getItem(LOCK_TIMEOUT) || '30'); } catch { lockTimeout = 30; }
  const theme = (localStorage.getItem(THEME) as AppTheme) || 'system';
  let dashboard: unknown = base?.dashboard_layout ?? null;
  try {
    const raw = localStorage.getItem(DASHBOARD);
    if (raw) dashboard = JSON.parse(raw);
  } catch { /* keep base */ }
  return {
    ready: true,
    pin_hash: pinHash,
    pin_enabled: enabled,
    lock_timeout: typeof lockTimeout === 'number' ? lockTimeout : 30,
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system',
    dashboard_layout: dashboard,
  };
}

export function rememberPersonal(patch?: Partial<PersonalProfile>) {
  if (!isAndroidApp() || !readProfile()?.ready) return;
  const next = { ...snapshotFromPage(readProfile()), ...patch, ready: true as const };
  writeProfile(next);
  applyProfileToPage(next);
}

function adopt(settings: PanelSlice) {
  const theme = settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'system'
    ? settings.theme
    : 'system';
  const profile: PersonalProfile = {
    ready: true,
    pin_hash: settings.pin_hash ?? null,
    pin_enabled: !!settings.pin_enabled,
    lock_timeout: typeof settings.lock_timeout === 'number' ? settings.lock_timeout : 30,
    theme,
    dashboard_layout: settings.dashboard_layout ?? null,
  };
  writeProfile(profile);
  applyProfileToPage(profile);
}

/** true = App hat ein eigenes Profil, der Aufrufer darf diese Felder nicht an den Pi schreiben. */
export function ensurePersonalProfile(): Promise<boolean> {
  if (!isAndroidApp()) return Promise.resolve(false);
  if (readProfile()?.ready) return Promise.resolve(true);
  if (!boot) {
    boot = import('@/lib/api').then(({ api }) => api.getPanelSettings()).then((settings) => {
      if (!readProfile()?.ready) adopt(settings);
      return true;
    }).catch(() => false);
  }
  return boot;
}
