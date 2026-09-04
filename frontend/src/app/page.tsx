import { serverApi } from '@/lib/api-server';
import DashboardLive from '@/components/DashboardLive';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const boot = await serverApi.getBootstrap();

  return (
    <DashboardLive
      initialDevices={boot.devices}
      rooms={boot.rooms}
      initialScenes={boot.scenes}
      initialWeather={boot.weather}
      initialTransit={boot.transit}
      initialEnergy={boot.energy}
      initialCalendar={boot.calendar}
    />
  );
}
