import { serverApi } from '@/lib/api-server';
import { emptyEnergyOverview, type EnergyHistoryResponse } from '@/lib/api';
import EnergyClient from './EnergyClient';

export default async function EnergyPage() {
  const [initial, initialHistory] = await Promise.all([
    serverApi.getEnergy().catch(() => emptyEnergyOverview('Energie nicht erreichbar')),
    serverApi.getEnergyHistory('day').catch((): EnergyHistoryResponse => ({
      range: 'day',
      buckets: [],
      price_per_kwh: 0.3,
      data_since: null,
    })),
  ]);

  return <EnergyClient initial={initial} initialHistory={initialHistory} />;
}
