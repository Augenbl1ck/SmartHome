'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { api } from '@/lib/api';
import {
  Zap, RefreshCw, ChevronDown, ChevronUp,
  Loader2, Save, RotateCcw, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props { deviceId: number; mode?: 'ble' | 'http' }

interface PowerStatus {
  apower: number;
  voltage: number;
  current: number;
  temperature?: { tC: number };
}

// Shelly LED: rgb = [0-100, 0-100, 0-100], brightness = 0-100
interface ShellyColor { rgb: [number, number, number]; brightness: number }
type LedMode    = 'switch' | 'off';
type InMode     = 'momentary' | 'detached' | 'follow' | 'flip';
type InitState  = 'restore_last' | 'on' | 'off' | 'match_input';

interface Config {
  // ── LED ─────────────────────────────────────────────
  ledMode:              LedMode;
  onColor:              ShellyColor;
  offColor:             ShellyColor;
  nightModeEnable:      boolean;
  nightModeBrightness:  number;
  nightModeFrom:        string;   // "HH:mm"
  nightModeTo:          string;   // "HH:mm"
  inMode:               InMode;
  // ── Switch ──────────────────────────────────────────
  autoOff:              boolean;
  autoOffMinutes:       number;
  autoOn:               boolean;
  autoOnMinutes:        number;
  initialState:         InitState;
  powerLimitWatts:     number | null;  // null = kein Limit (Shelly-Default)
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function colorToHex(c: ShellyColor): string {
  const [r, g, b] = c.rgb.map(v => Math.round(v * 255 / 100));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
function hexToShellyRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [
    Math.round(((n >> 16) & 255) * 100 / 255),
    Math.round(((n >>  8) & 255) * 100 / 255),
    Math.round(( n        & 255) * 100 / 255),
  ];
}

const DEFAULT_CONFIG: Config = {
  ledMode:             'switch',
  onColor:             { rgb: [0, 71, 0],   brightness: 100 },
  offColor:            { rgb: [20, 20, 20], brightness: 20  },
  nightModeEnable:     false,
  nightModeBrightness: 10,
  nightModeFrom:       '22:00',
  nightModeTo:         '06:00',
  inMode:              'momentary',
  autoOff:             false,
  autoOffMinutes:      60,
  autoOn:              false,
  autoOnMinutes:       5,
  initialState:        'restore_last',
  powerLimitWatts:     null,
};

// ─────────────────────────────────────────────────────────────────────────────

export default function ShellyPlugPanel({ deviceId, mode = 'ble' }: Props) {
  const [expanded,      setExpanded]      = useState(false);
  const [loadingPower,  setLoadingPower]  = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [reverting,     setReverting]     = useState(false);
  const [power,         setPower]         = useState<PowerStatus | null>(null);
  const [committed,     setCommitted]     = useState<Config | null>(null);
  const [draft,         setDraft]         = useState<Config | null>(null);
  const [configLoaded,  setConfigLoaded]  = useState(false);
  const [savedOk,       setSavedOk]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [powerError,    setPowerError]    = useState<string | null>(null);

  const ledTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (ledTimerRef.current)    clearTimeout(ledTimerRef.current);
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
  }, []);

  const isDirty = committed !== null && draft !== null &&
    JSON.stringify(committed) !== JSON.stringify(draft);

  const rpc = useCallback((method: string, params: Record<string, unknown> = {}) =>
    mode === 'http' ? api.shellyRpc(deviceId, method, params) : api.bleRpc(deviceId, method, params),
  [deviceId, mode]);

  // ── RPC send helpers ──────────────────────────────────────────────────────

  const sendLed = useCallback(async (cfg: Config) => {
    try {
      await rpc('PLUGS_UI.SetConfig', {
        config: {
          leds: {
            mode: cfg.ledMode,
            ...(cfg.ledMode === 'switch' ? {
              colors: {
                'switch:0': {
                  on:  { rgb: cfg.onColor.rgb,  brightness: cfg.onColor.brightness  },
                  off: { rgb: cfg.offColor.rgb, brightness: cfg.offColor.brightness },
                },
              },
            } : {}),
            night_mode: {
              enable:         cfg.nightModeEnable,
              brightness:     cfg.nightModeBrightness,
              active_between: [cfg.nightModeFrom, cfg.nightModeTo],
            },
          },
          controls: {
            'switch:0': { in_mode: cfg.inMode },
          },
        },
      });
    } catch { /* live preview */ }
  }, [rpc]);

  const sendSwitch = useCallback(async (cfg: Config) => {
    try {
      await rpc('Switch.SetConfig', {
        id: 0,
        config: {
          auto_off:       cfg.autoOff,
          auto_off_delay: cfg.autoOffMinutes * 60,
          auto_on:        cfg.autoOn,
          auto_on_delay:  cfg.autoOnMinutes * 60,
          initial_state:  cfg.initialState,
          power_limit:    cfg.powerLimitWatts,
        },
      });
    } catch { /* live preview */ }
  }, [rpc]);

  const debouncedSendLed = useCallback((cfg: Config, ms = 500) => {
    if (ledTimerRef.current) clearTimeout(ledTimerRef.current);
    ledTimerRef.current = setTimeout(() => sendLed(cfg), ms);
  }, [sendLed]);

  const debouncedSendSwitch = useCallback((cfg: Config, ms = 500) => {
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    switchTimerRef.current = setTimeout(() => sendSwitch(cfg), ms);
  }, [sendSwitch]);

  // ── Draft update helper ───────────────────────────────────────────────────

  type Target = 'led' | 'switch';

  const update = useCallback((
    patch: (prev: Config) => Partial<Config>,
    target: Target,
    immediate = false,
  ) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch(prev) };
      const ms = immediate ? 0 : 500;
      if (target === 'led')    debouncedSendLed(next, ms);
      if (target === 'switch') debouncedSendSwitch(next, ms);
      return next;
    });
  }, [debouncedSendLed, debouncedSendSwitch]);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchPower = async () => {
    setLoadingPower(true);
    setPowerError(null);
    try {
      const res = await rpc('Switch.GetStatus', { id: 0 });
      setPower(res.result as PowerStatus);
    } catch (e) {
      setPowerError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setLoadingPower(false);
    }
  };

  // Verbrauch immer laden und periodisch aktualisieren
  useEffect(() => {
    let cancelled = false;
    const tick = async (showSpinner: boolean) => {
      if (cancelled) return;
      if (showSpinner) setLoadingPower(true);
      setPowerError(null);
      try {
        const res = await rpc('Switch.GetStatus', { id: 0 });
        if (!cancelled) setPower(res.result as PowerStatus);
      } catch (e) {
        if (!cancelled) setPowerError(e instanceof Error ? e.message : 'Fehler');
      } finally {
        if (!cancelled && showSpinner) setLoadingPower(false);
      }
    };
    void tick(true);
    const id = setInterval(() => { void tick(false); }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [rpc]);

  const fetchConfig = async () => {
    if (configLoaded) return;
    setLoadingConfig(true);
    setError(null);
    try {
      const switchRes = await rpc('Switch.GetConfig', { id: 0 });
      const sc = switchRes.result as {
        auto_off?: boolean; auto_off_delay?: number;
        auto_on?:  boolean; auto_on_delay?:  number;
        initial_state?: InitState;
        power_limit?: number | null;
        in_mode?: InMode;
      };

      const cfg: Config = { ...DEFAULT_CONFIG };
      cfg.autoOff           = sc.auto_off    ?? false;
      cfg.autoOffMinutes    = Math.round((sc.auto_off_delay ?? 3600) / 60);
      cfg.autoOn            = sc.auto_on     ?? false;
      cfg.autoOnMinutes     = Math.round((sc.auto_on_delay  ?? 300) / 60);
      cfg.initialState      = sc.initial_state ?? 'restore_last';
      cfg.powerLimitWatts   = sc.power_limit ?? null;
      if (sc.in_mode) cfg.inMode = sc.in_mode;

      try {
        const ledRes = await rpc('PLUGS_UI.GetConfig', {});
        const leds = (ledRes.result as {
          leds?: {
            mode?: string;
            colors?: { 'switch:0'?: { on?: ShellyColor; off?: ShellyColor } };
            night_mode?: { enable?: boolean; brightness?: number; active_between?: string[] };
          };
          controls?: { 'switch:0'?: { in_mode?: InMode } };
        });
        const ledsObj = leds?.leds;
        const nm      = ledsObj?.night_mode;
        const ctrl    = leds?.controls?.['switch:0'];

        cfg.ledMode = ledsObj?.mode === 'off' ? 'off' : 'switch';
        const col = ledsObj?.colors?.['switch:0'];
        if (col?.on)  cfg.onColor  = col.on;
        if (col?.off) cfg.offColor = col.off;

        cfg.nightModeEnable     = nm?.enable     ?? false;
        cfg.nightModeBrightness = nm?.brightness ?? 10;
        cfg.nightModeFrom       = nm?.active_between?.[0] ?? '22:00';
        cfg.nightModeTo         = nm?.active_between?.[1] ?? '06:00';

        if (ctrl?.in_mode) cfg.inMode = ctrl.in_mode;
      } catch { /* PLUGS_UI nicht verfügbar */ }

      setCommitted(cfg);
      setDraft(cfg);
      setConfigLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konfiguration nicht abrufbar');
    } finally {
      setLoadingConfig(false);
    }
  };

  // ── Config open / close ──────────────────────────────────────────────────

  const handleExpand = async () => {
    if (expanded && isDirty && committed) {
      setReverting(true);
      if (ledTimerRef.current)    clearTimeout(ledTimerRef.current);
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
      await Promise.all([sendLed(committed), sendSwitch(committed)]).catch(() => {});
      setDraft(committed);
      setReverting(false);
    }
    const next = !expanded;
    setExpanded(next);
    if (next) await fetchConfig();
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const saveAll = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      if (ledTimerRef.current)    clearTimeout(ledTimerRef.current);
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
      await sendLed(draft);
      await sendSwitch(draft);
      setCommitted(draft);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  // ── Revert ────────────────────────────────────────────────────────────────

  const revertDraft = async () => {
    if (!committed) return;
    setReverting(true);
    if (ledTimerRef.current)    clearTimeout(ledTimerRef.current);
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    await Promise.all([sendLed(committed), sendSwitch(committed)]).catch(() => {});
    setDraft(committed);
    setReverting(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mt-2 border-t pt-2 space-y-1">

      {/* ── Verbrauch (immer sichtbar, Auto-Refresh) ───────────────── */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Zap className="h-3 w-3" />
        Verbrauch
        {loadingPower && !power && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>

      <div className="mt-1 mb-2">
        {powerError && (
          <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1 mb-1">{powerError}</p>
        )}
        {loadingPower && !power ? (
          <Spinner label="Verbinde…" />
        ) : power ? (
          <div className="grid grid-cols-2 gap-1">
            <Stat label="Leistung" value={`${power.apower.toFixed(1)} W`} highlight={power.apower > 0} />
            <Stat label="Spannung" value={`${power.voltage.toFixed(0)} V`} />
            <Stat label="Strom"    value={`${(power.current * 1000).toFixed(0)} mA`} />
            {power.temperature && (
              <Stat label="Chip-Temp" value={`${power.temperature.tC.toFixed(1)} °C`} />
            )}
            <button type="button" onClick={fetchPower} disabled={loadingPower}
              className="cursor-pointer col-span-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 mt-0.5">
              <RefreshCw className={cn('h-2.5 w-2.5', loadingPower && 'animate-spin')} />
              Aktualisieren
            </button>
          </div>
        ) : null}
      </div>

      {/* ── Konfiguration ───────────────────────────────────────────── */}
      <button type="button" onClick={handleExpand}
        className="cursor-pointer flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Settings className="h-3 w-3" />
        Gerät konfigurieren
        {reverting
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {expanded && (
        <div className="mt-1 space-y-4 max-h-72 overflow-y-auto overflow-x-hidden pr-1">
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{error}</p>
          )}

          {/* ── Konfiguration ──────────────────────────────────────────── */}
          {loadingConfig ? (
            <Spinner label="Konfiguration laden…" />
          ) : configLoaded && draft ? (
            <>
              {/* ── LED-Modus ────────────────────────────────────────── */}
              <Section label="LED">
                <div className="space-y-3">
                  {/* Modus */}
                  <div className="flex gap-1">
                    <ModeButton label="Farbe" active={draft.ledMode === 'switch'} disabled={saving || reverting}
                      onClick={() => update(() => ({ ledMode: 'switch' }), 'led', true)} />
                    <ModeButton label="Aus"   active={draft.ledMode === 'off'}    disabled={saving || reverting}
                      onClick={() => update(() => ({ ledMode: 'off'    }), 'led', true)} />
                  </div>

                  {/* Farben */}
                  {draft.ledMode === 'switch' && (
                    <div>
                      <Label className="mb-1.5">
                        Farben
                      </Label>
                      <div className="space-y-2">
                        <ColorRow label="Eingeschaltet" color={draft.onColor}
                          onChange={c => update(() => ({ onColor:  c }), 'led')} />
                        <ColorRow label="Ausgeschaltet" color={draft.offColor}
                          onChange={c => update(() => ({ offColor: c }), 'led')} />
                      </div>
                    </div>
                  )}

                  {/* Nacht-Modus */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Label>Nacht-Modus</Label>
                      <Toggle
                        checked={draft.nightModeEnable}
                        disabled={saving || reverting}
                        onChange={() => update(p => ({ nightModeEnable: !p.nightModeEnable }), 'led', true)}
                      />
                    </div>
                    {draft.nightModeEnable && (
                      <div className="space-y-2 pl-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-16">Von / Bis</span>
                          <input type="time" value={draft.nightModeFrom}
                            onChange={e => update(() => ({ nightModeFrom: e.target.value }), 'led')}
                            className="text-xs rounded border bg-background px-1.5 py-0.5 w-20" />
                          <span className="text-xs text-muted-foreground">–</span>
                          <input type="time" value={draft.nightModeTo}
                            onChange={e => update(() => ({ nightModeTo: e.target.value }), 'led')}
                            className="text-xs rounded border bg-background px-1.5 py-0.5 w-20" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-16">Helligkeit</span>
                          <input type="range" min={0} max={100} value={draft.nightModeBrightness}
                            onChange={e => update(() => ({ nightModeBrightness: parseInt(e.target.value) }), 'led')}
                            className="flex-1 h-1 cursor-pointer accent-primary" />
                          <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">
                            {draft.nightModeBrightness}%
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Section>

              {/* ── Taster-Verhalten ─────────────────────────────────── */}
              <Section label="Taster-Verhalten">
                <div className="space-y-1">
                  {IN_MODE_OPTIONS.map(({ value, label, desc }) => (
                    <button key={value} type="button"
                      disabled={saving || reverting}
                      onClick={() => update(() => ({ inMode: value }), 'led', true)}
                      className={cn(
                        'cursor-pointer w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg border transition-colors',
                        draft.inMode === value
                          ? 'bg-primary/10 border-primary/40 text-foreground'
                          : 'border-transparent hover:bg-accent text-muted-foreground',
                        (saving || reverting) && 'opacity-50 cursor-not-allowed'
                      )}>
                      <span className={cn('text-xs font-medium w-20 shrink-0', draft.inMode === value && 'text-primary')}>
                        {label}
                      </span>
                      <span className="text-[10px] leading-tight">{desc}</span>
                    </button>
                  ))}
                </div>
              </Section>

              {/* ── Timer ────────────────────────────────────────────── */}
              <Section label="Timer">
                <div className="space-y-2">
                  {/* Auto-Aus */}
                  <TimerRow
                    label="Auto-Aus"
                    enabled={draft.autoOff}
                    minutes={draft.autoOffMinutes}
                    onToggle={() => update(p => ({ autoOff: !p.autoOff }), 'switch', true)}
                    onMinutes={v => update(() => ({ autoOffMinutes: v }), 'switch')}
                    disabled={saving || reverting}
                  />
                  {/* Auto-An */}
                  <TimerRow
                    label="Auto-An"
                    enabled={draft.autoOn}
                    minutes={draft.autoOnMinutes}
                    onToggle={() => update(p => ({ autoOn: !p.autoOn }), 'switch', true)}
                    onMinutes={v => update(() => ({ autoOnMinutes: v }), 'switch')}
                    disabled={saving || reverting}
                  />
                </div>
              </Section>

              {/* ── Verhalten ────────────────────────────────────────── */}
              <Section label="Nach Stromausfall">
                <div className="grid grid-cols-2 gap-1">
                  {(['restore_last', 'on', 'off', 'match_input'] as InitState[]).map(s => (
                    <ModeButton key={s} active={draft.initialState === s} disabled={saving || reverting}
                      label={INIT_STATE_LABELS[s]}
                      onClick={() => update(() => ({ initialState: s }), 'switch', true)} />
                  ))}
                </div>
              </Section>

              {/* ── Überlastschutz ───────────────────────────────────── */}
              <Section label="Überlastschutz">
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="number" min={1} max={3680}
                    placeholder="kein Limit"
                    value={draft.powerLimitWatts ?? ''}
                    disabled={saving || reverting}
                    onChange={e => {
                      const v = e.target.value === '' ? null : Math.max(1, parseInt(e.target.value) || 1);
                      update(() => ({ powerLimitWatts: v }), 'switch');
                    }}
                    className="w-24 rounded border bg-background px-1.5 py-0.5 text-xs text-center disabled:opacity-50"
                  />
                  <span className="text-xs text-muted-foreground">W &nbsp;(leer = kein Limit)</span>
                </div>
              </Section>

              {/* ── Aktions-Buttons ──────────────────────────────────── */}
              <div className="flex gap-2 pt-1">
                {isDirty && (
                  <button type="button" onClick={revertDraft} disabled={reverting || saving}
                    className="cursor-pointer flex items-center justify-center gap-1 text-xs
                      py-1.5 px-3 rounded-lg border border-border text-muted-foreground
                      hover:bg-accent transition-colors disabled:opacity-50">
                    {reverting
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <RotateCcw className="h-3 w-3" />}
                    Zurücksetzen
                  </button>
                )}
                <button type="button" onClick={saveAll} disabled={saving || reverting}
                  className="cursor-pointer flex-1 flex items-center justify-center gap-1.5 text-xs font-medium
                    py-1.5 rounded-lg border border-primary/30 bg-primary/5 text-primary
                    hover:bg-primary/10 transition-colors disabled:opacity-50">
                  {saving
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : savedOk
                    ? '✓ Gespeichert'
                    : <><Save className="h-3 w-3" /> Speichern</>}
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const IN_MODE_OPTIONS: { value: InMode; label: string; desc: string }[] = [
  {
    value: 'momentary',
    label: 'Normaler Taster',
    desc:  'Kurz drücken schaltet die Steckdose ein oder aus (Standard)',
  },
  {
    value: 'detached',
    label: 'Entkoppelt',
    desc:  'Physischer Knopf schaltet nichts — Steckdose nur per App oder Automation steuerbar',
  },
  {
    value: 'follow',
    label: 'Folgen ¹',
    desc:  'Steckdose an solange Eingang aktiv, aus wenn losgelassen (nur für Schalter-Eingänge)',
  },
  {
    value: 'flip',
    label: 'Umschalten ¹',
    desc:  'Jede Zustandsänderung am Eingang wechselt den Schaltzustand (nur für Schalter-Eingänge)',
  },
];
const INIT_STATE_LABELS: Record<InitState, string> = {
  restore_last:  'Letzter Status',
  on:            'Immer An',
  off:           'Immer Aus',
  match_input:   'Taste folgen',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ label, children, action }: {
  label: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-[11px] font-semibold uppercase tracking-wider text-muted-foreground', className)}>
      {children}
    </p>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" /> {label}
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: {
  checked: boolean; onChange: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked}
      onClick={onChange} disabled={disabled}
      className={cn(
        'cursor-pointer relative h-5 w-9 rounded-full transition-colors shrink-0 overflow-hidden',
        checked ? 'bg-primary' : 'bg-muted',
        disabled && 'opacity-50 cursor-not-allowed'
      )}>
      <span className={cn(
        'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200',
        checked ? 'left-4.5' : 'left-0.5'
      )} />
    </button>
  );
}

function ModeButton({ label, active, disabled, onClick }: {
  label: string; active: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn(
        'cursor-pointer flex-1 text-xs py-1 px-2 rounded-lg border transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card border-border text-muted-foreground hover:bg-accent',
        disabled && 'opacity-50 cursor-not-allowed',
      )}>
      {label}
    </button>
  );
}

function ColorRow({ label, color, onChange }: {
  label: string; color: ShellyColor; onChange: (c: ShellyColor) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-28 shrink-0">{label}</span>
      <input type="color"
        value={colorToHex(color)}
        onChange={e => onChange({ ...color, rgb: hexToShellyRgb(e.target.value) })}
        className="cursor-pointer h-6 w-8 rounded border border-border bg-transparent p-0.5" />
      <div className="flex items-center gap-1 flex-1">
        <span className="text-[10px] text-muted-foreground shrink-0">Hell</span>
        <input type="range" min={0} max={100} value={color.brightness}
          onChange={e => onChange({ ...color, brightness: parseInt(e.target.value) })}
          className="flex-1 h-1 cursor-pointer accent-primary" />
        <span className="text-[10px] tabular-nums text-muted-foreground w-7 text-right">
          {color.brightness}%
        </span>
      </div>
    </div>
  );
}

function TimerRow({ label, enabled, minutes, onToggle, onMinutes, disabled }: {
  label: string; enabled: boolean; minutes: number;
  onToggle: () => void; onMinutes: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground w-14 shrink-0">{label}</span>
      <Toggle checked={enabled} onChange={onToggle} disabled={disabled} />
      {enabled && (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">nach</span>
          <input type="number" min={1} max={480} value={minutes}
            onChange={e => onMinutes(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-14 rounded border bg-background px-1.5 py-0.5 text-xs text-center" />
          <span className="text-muted-foreground">Min</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: {
  label: string; value: string; highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn('font-medium tabular-nums', highlight && 'text-amber-500')}>{value}</span>
    </div>
  );
}
