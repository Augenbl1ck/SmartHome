import { serverApi } from '@/lib/api-server';
import DashboardLive from '@/components/DashboardLive';
import type { CalendarEventsResponse } from '@/lib/api';

export default async function DashboardPage() {
  const [rooms, devices, scenes, calendar] = await Promise.all([
    serverApi.getRooms(),
    serverApi.getDevices(),
    serverApi.getScenes(),
    serverApi.getDashboardCalendar().catch((): CalendarEventsResponse => ({
      events: [],
      configured: false,
      error: 'Kalender nicht erreichbar',
    })),
  ]);

  return (
    <DashboardLive
      initialDevices={devices}
      rooms={rooms}
      initialScenes={scenes}
      initialCalendar={calendar}
    />
  );
}
