import { serverApi } from '@/lib/api-server';
import type { EnergyHistoryResponse, EnergyOverview } from '@/lib/api';
import EnergyClient from './EnergyClient';

export default async function EnergyPage() {
  const [initial, initialHistory] = await Promise.all([
    serverApi.getEnergy().catch((): EnergyOverview => ({
      configured: false,
      price_per_kwh: 0.3,
      live_power_w: 0,
      today_kwh: 0,
      week_kwh: 0,
      today_cost: 0,
      week_cost: 0,
      devices: [],
      by_device_today: [],
      error: 'Energie nicht erreichbar',
    })),
    serverApi.getEnergyHistory('day').catch((): EnergyHistoryResponse => ({
      range: 'day',
      buckets: [],
      price_per_kwh: 0.3,
    })),
  ]);

  return <EnergyClient initial={initial} initialHistory={initialHistory} />;
}
