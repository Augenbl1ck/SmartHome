'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, Device } from '@/lib/api';
import {
  Zap, ChevronDown, ChevronUp, Loader2, Save, RotateCcw, Settings, Scan,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  device: Device;
  onUpdated?: (device: Device) => void;
}

type IndicatorMode = 'off' | 'off/on' | 'on/off' | 'on';
type OutageMemory = 'on' | 'off' | 'restore';
type SwitchType = 'release' | 'press';

interface Config {
  indicatorMode: IndicatorMode | '';
  powerOutageMemory: OutageMemory | '';
  childLock: boolean;
  countdownEnabled: boolean;
  countdownMinutes: number;
  switchType: SwitchType | '';
  nightModeEnable: boolean;
  nightModeFrom: string;
  nightModeTo: string;
}

/** Zigbee2MQTT `indicator_mode`: `aus/an` = LED bei Stecker aus / LED bei Stecker an. */
const INDICATOR_OPTIONS: { value: IndicatorMode; label: string; desc: string }[] = [
  { value: 'off/on', label: 'An wenn an', desc: 'LED leuchtet, wenn die Steckdose eingeschaltet ist' },
  { value: 'on/off', label: 'An wenn aus', desc: 'LED leuchtet, wenn die Steckdose ausgeschaltet ist' },
  { value: 'on', label: 'Immer an', desc: 'LED leuchtet unabhängig vom Schaltzustand' },
  { value: 'off', label: 'Immer aus', desc: 'LED bleibt aus — z. B. im Schlafzimmer' },
];

const OUTAGE_LABELS: Record<OutageMemory, string> = {
  restore: 'Letzter Status',
  on: 'Immer An',
  off: 'Immer Aus',
};

const SWITCH_OPTIONS: { value: SwitchType; label: string; desc: string }[] = [
  { value: 'release', label: 'Loslassen', desc: 'Schaltet beim Loslassen der Taste' },
  { value: 'press', label: 'Drücken', desc: 'Schaltet beim Drücken der Taste' },
];

function isIndicator(v: unknown): v is IndicatorMode {
  return v === 'off' || v === 'off/on' || v === 'on/off' || v === 'on';
}
function isOutage(v: unknown): v is OutageMemory {
  return v === 'on' || v === 'off' || v === 'restore';
}
function isSwitchType(v: unknown): v is SwitchType {
  return v === 'release' || v === 'press';
}

function configFromAttrs(attrs: Record<string, unknown> | undefined): Config {
  const countdown = typeof attrs?.countdown === 'number' ? attrs.countdown : 0;
  const dayMode = isIndicator(attrs?.led_day_mode) ? attrs.led_day_mode : null;
  return {
    indicatorMode: dayMode ?? (isIndicator(attrs?.indicator_mode) ? attrs.indicator_mode : ''),
    powerOutageMemory: isOutage(attrs?.power_outage_memory) ? attrs.power_outage_memory : '',
    childLock: String(attrs?.child_lock ?? '').toUpperCase() === 'LOCK',
    countdownEnabled: countdown > 0,
    countdownMinutes: countdown > 0 ? Math.max(1, Math.round(countdown / 60)) : 60,
    switchType: isSwitchType(attrs?.switch_type_button) ? attrs.switch_type_button : '',
    nightModeEnable: attrs?.led_night_enable === true || attrs?.led_night_enable === 1,
    nightModeFrom: typeof attrs?.led_night_from === 'string' ? attrs.led_night_from.slice(0, 5) : '22:00',
    nightModeTo: typeof attrs?.led_night_to === 'string' ? attrs.led_night_to.slice(0, 5) : '06:00',
  };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export default function ZigbeePlugPanel({ device, onUpdated }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Config>(() => configFromAttrs(device.attributes));
  const [committed, setCommitted] = useState<Config>(() => configFromAttrs(device.attributes));
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attrs = device.attributes ?? {};
  const powerW = num(attrs.power_w);
  const voltage = num(attrs.voltage);
  const current = num(attrs.current);
  const energy = num(attrs.energy_wh);
  const vendor = typeof attrs.vendor === 'string' ? attrs.vendor : '';
  const model = typeof attrs.model === 'string' ? attrs.model : '';
  const modelLine = [vendor, model].filter(Boolean).join(' ');

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(committed),
    [draft, committed],
  );

  useEffect(() => {
    if (!expanded || dirty) return;
    const next = configFromAttrs(device.attributes);
    setDraft(next);
    setCommitted(next);
  }, [device.attributes, expanded, dirty]);

  const requestGet = useCallback(async () => {
    setLoadingConfig(true);
    setError(null);
    try {
      await api.zigbeeSet(device.id, {
        indicator_mode: '',
        power_outage_memory: '',
        child_lock: '',
        countdown: '',
        switch_type_button: '',
      }, { get: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konfiguration nicht lesbar');
    } finally {
      setLoadingConfig(false);
    }
  }, [device.id]);

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      setDraft(configFromAttrs(device.attributes));
      setCommitted(configFromAttrs(device.attributes));
      void requestGet();
    }
  };

  const saveAll = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        child_lock: draft.childLock ? 'LOCK' : 'UNLOCK',
        countdown: draft.countdownEnabled
          ? Math.min(43200, Math.max(1, Math.round(draft.countdownMinutes * 60)))
          : 0,
        led_night_enable: draft.nightModeEnable,
        led_night_from: draft.nightModeFrom.slice(0, 5),
        led_night_to: draft.nightModeTo.slice(0, 5),
      };
      if (draft.indicatorMode) {
        payload.indicator_mode = draft.indicatorMode;
        payload.led_day_mode = draft.indicatorMode;
      }
      if (draft.powerOutageMemory) payload.power_outage_memory = draft.powerOutageMemory;
      if (draft.switchType) payload.switch_type_button = draft.switchType;

      const updated = await api.zigbeeSet(device.id, payload);
      setCommitted(draft);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
      onUpdated?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const revertDraft = () => {
    setDraft(committed);
  };

  const identify = async () => {
    setIdentifying(true);
    setError(null);
    try {
      await api.zigbeeSet(device.id, { identify: '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Identifizieren fehlgeschlagen');
    } finally {
      setIdentifying(false);
    }
  };

  const hasLive = powerW != null || voltage != null || current != null || energy != null;

  return (
    <div className="mt-2 border-t pt-2 space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          Verbrauch
        </span>
        {modelLine && (
          <span className="truncate text-[10px] text-muted-foreground/80">{modelLine}</span>
        )}
      </div>

      <div className="mt-1 mb-2">
        {hasLive ? (
          <div className="grid grid-cols-2 gap-1">
            {powerW != null && (
              <Stat label="Leistung" value={`${powerW.toFixed(1)} W`} highlight={powerW > 0} />
            )}
            {voltage != null && <Stat label="Spannung" value={`${voltage.toFixed(0)} V`} />}
            {current != null && (
              <Stat
                label="Strom"
                value={current >= 1 ? `${current.toFixed(2)} A` : `${Math.round(current * 1000)} mA`}
              />
            )}
            {energy != null && <Stat label="Energie" value={`${energy.toFixed(2)} kWh`} />}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Noch keine Messwerte — wartet auf Zigbee.</p>
        )}
      </div>

      <button type="button" onClick={handleExpand}
        className="cursor-pointer flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Settings className="h-3 w-3" />
        Gerät konfigurieren
        {loadingConfig
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {expanded && (
        <div className="mt-1 space-y-4 max-h-72 overflow-y-auto overflow-x-hidden pr-1">
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{error}</p>
          )}

          <Section label="LED-Anzeige">
            <p className="text-[10px] text-muted-foreground mb-2">
              Einfache Status-LED, kein Farbring.
            </p>
            <div className="space-y-1">
              {INDICATOR_OPTIONS.map(({ value, label, desc }) => (
                <button key={value} type="button"
                  disabled={saving}
                  onClick={() => setDraft(p => ({ ...p, indicatorMode: value }))}
                  className={cn(
                    'cursor-pointer w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg border transition-colors',
                    draft.indicatorMode === value
                      ? 'bg-primary/10 border-primary/40 text-foreground'
                      : 'border-transparent hover:bg-accent text-muted-foreground',
                    saving && 'opacity-50 cursor-not-allowed',
                  )}>
                  <span className={cn('text-xs font-medium w-24 shrink-0', draft.indicatorMode === value && 'text-primary')}>
                    {label}
                  </span>
                  <span className="text-[10px] leading-tight">{desc}</span>
                </button>
              ))}
            </div>
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nacht-Modus</p>
                <Toggle
                  checked={draft.nightModeEnable}
                  disabled={saving}
                  onChange={() => setDraft(p => ({ ...p, nightModeEnable: !p.nightModeEnable }))}
                />
              </div>
              {draft.nightModeEnable && (
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground">
                    LED wird nachts ausgeschaltet (kein Dimmen am Gerät).
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-16 shrink-0">Von / Bis</span>
                    <input type="time" value={draft.nightModeFrom}
                      onChange={e => setDraft(p => ({ ...p, nightModeFrom: e.target.value.slice(0, 5) }))}
                      className="w-20 rounded border bg-background px-1.5 py-0.5 text-xs text-center appearance-none outline-none focus:outline-none focus:ring-0 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-inner-spin-button]:hidden" />
                    <span className="text-xs text-muted-foreground">–</span>
                    <input type="time" value={draft.nightModeTo}
                      onChange={e => setDraft(p => ({ ...p, nightModeTo: e.target.value.slice(0, 5) }))}
                      className="w-20 rounded border bg-background px-1.5 py-0.5 text-xs text-center appearance-none outline-none focus:outline-none focus:ring-0 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-inner-spin-button]:hidden" />
                  </div>
                </div>
              )}
            </div>
          </Section>

          <Section label="Nach Stromausfall">
            <div className="grid grid-cols-3 gap-1">
              {(['restore', 'on', 'off'] as OutageMemory[]).map(s => (
                <ModeButton key={s} active={draft.powerOutageMemory === s} disabled={saving}
                  label={OUTAGE_LABELS[s]}
                  onClick={() => setDraft(p => ({ ...p, powerOutageMemory: s }))} />
              ))}
            </div>
          </Section>

          <Section label="Kindersicherung">
            <div className="flex items-center gap-2">
              <Toggle
                checked={draft.childLock}
                disabled={saving}
                onChange={() => setDraft(p => ({ ...p, childLock: !p.childLock }))}
              />
              <span className="text-xs text-muted-foreground">
                {draft.childLock ? 'Taste am Gerät gesperrt' : 'Taste am Gerät aktiv'}
              </span>
            </div>
          </Section>

          <Section label="Timer">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground w-14 shrink-0">Countdown</span>
              <Toggle
                checked={draft.countdownEnabled}
                disabled={saving}
                onChange={() => setDraft(p => ({ ...p, countdownEnabled: !p.countdownEnabled }))}
              />
              {draft.countdownEnabled && (
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-muted-foreground">nach</span>
                  <input type="number" min={1} max={720} value={draft.countdownMinutes}
                    onChange={e => setDraft(p => ({
                      ...p,
                      countdownMinutes: Math.max(1, Math.min(720, parseInt(e.target.value) || 1)),
                    }))}
                    className="w-14 rounded border bg-background px-1.5 py-0.5 text-xs text-center" />
                  <span className="text-muted-foreground">Min umschalten</span>
                </div>
              )}
            </div>
          </Section>

          <Section label="Taster">
            <div className="space-y-1">
              {SWITCH_OPTIONS.map(({ value, label, desc }) => (
                <button key={value} type="button"
                  disabled={saving}
                  onClick={() => setDraft(p => ({ ...p, switchType: value }))}
                  className={cn(
                    'cursor-pointer w-full flex items-center gap-2 text-left px-2 py-1.5 rounded-lg border transition-colors',
                    draft.switchType === value
                      ? 'bg-primary/10 border-primary/40 text-foreground'
                      : 'border-transparent hover:bg-accent text-muted-foreground',
                    saving && 'opacity-50 cursor-not-allowed',
                  )}>
                  <span className={cn('text-xs font-medium w-20 shrink-0', draft.switchType === value && 'text-primary')}>
                    {label}
                  </span>
                  <span className="text-[10px] leading-tight">{desc}</span>
                </button>
              ))}
            </div>
          </Section>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={identify} disabled={identifying || saving}
              className="cursor-pointer flex items-center justify-center gap-1 text-xs
                py-1.5 px-3 rounded-lg border border-border text-muted-foreground
                hover:bg-accent transition-colors disabled:opacity-50">
              {identifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scan className="h-3 w-3" />}
              Identifizieren
            </button>
            {dirty && (
              <button type="button" onClick={revertDraft} disabled={saving}
                className="cursor-pointer flex items-center justify-center gap-1 text-xs
                  py-1.5 px-3 rounded-lg border border-border text-muted-foreground
                  hover:bg-accent transition-colors disabled:opacity-50">
                <RotateCcw className="h-3 w-3" />
                Zurücksetzen
              </button>
            )}
            <button type="button" onClick={saveAll} disabled={saving}
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
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</p>
      {children}
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
        disabled && 'opacity-50 cursor-not-allowed',
      )}>
      <span className={cn(
        'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200',
        checked ? 'left-4.5' : 'left-0.5',
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
