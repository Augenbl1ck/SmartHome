import { serverApi } from '@/lib/api-server';
import DashboardLive from '@/components/DashboardLive';

export default async function DashboardPage() {
  const [rooms, devices, scenes] = await Promise.all([
    serverApi.getRooms(),
    serverApi.getDevices(),
    serverApi.getScenes(),
  ]);

  return (
    <DashboardLive initialDevices={devices} rooms={rooms} initialScenes={scenes} />
  );
}



