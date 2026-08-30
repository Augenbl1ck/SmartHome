import { NextResponse } from 'next/server';
import { serverApi } from '@/lib/api-server';
import { fetchWeatherData } from '@/lib/weather-fetch';
import type { WeatherResponse } from '@/lib/api';

export const revalidate = 300;

export async function GET() {
  try {
    const settings = await serverApi.getPanelSettings();
    const data = await fetchWeatherData(settings);
    return NextResponse.json(data);
  } catch {
    const fallback: WeatherResponse = {
      configured: false,
      unit: 'metric',
      error: 'Wetter nicht erreichbar',
    };
    return NextResponse.json(fallback, { status: 200 });
  }
}
