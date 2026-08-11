import { serverApi } from '@/lib/api-server';
import type { WeatherResponse } from '@/lib/api';
import WeatherClient from './WeatherClient';

export default async function WeatherPage() {
  const initial = await serverApi.getWeather().catch((): WeatherResponse => ({
    configured: false,
    unit: 'metric',
    error: 'Wetter nicht erreichbar',
  }));

  return <WeatherClient initial={initial} />;
}
