import { serverApi } from '@/lib/api-server';
import DashboardLive from '@/components/DashboardLive';
import type { CalendarEventsResponse, TransitBoardResponse, WeatherResponse } from '@/lib/api';

export default async function DashboardPage() {
  const [rooms, devices, scenes, calendar, weather, transit] = await Promise.all([
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
  ]);

  return (
    <DashboardLive
      initialDevices={devices}
      rooms={rooms}
      initialScenes={scenes}
      initialCalendar={calendar}
      initialWeather={weather}
      initialTransit={transit}
    />
  );
}
