import { serverApi } from '@/lib/api-server';
import DashboardLive from '@/components/DashboardLive';
import type { CalendarEventsResponse, EnergyOverview, TransitBoardResponse, WeatherResponse } from '@/lib/api';

export default async function DashboardPage() {
  const [rooms, devices, scenes, calendar, weather, transit, energy] = await Promise.all([
    serverApi.getRooms(),
    serverApi.getDevices(),
    serverApi.getScenes(),
    serverApi.getDashboardCalendar().catch((): CalendarEventsResponse => ({
      events: [],
      configured: false,
      error: 'Kalender nicht erreichbar',
    })),
    serverApi.getWeather().catch((): WeatherResponse => ({
      configured: false,
      unit: 'metric',
      error: 'Wetter nicht erreichbar',
    })),
    serverApi.getTransitBoard().catch((): TransitBoardResponse => ({
      configured: false,
      stations: [],
      connections: [],
      error: 'Bahn nicht erreichbar',
    })),
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
  ]);

  return (
    <DashboardLive
      initialDevices={devices}
      rooms={rooms}
      initialScenes={scenes}
      initialCalendar={calendar}
      initialWeather={weather}
      initialTransit={transit}
      initialEnergy={energy}
    />
  );
}
