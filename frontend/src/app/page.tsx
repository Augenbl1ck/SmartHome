import { serverApi } from '@/lib/api-server';
import DashboardLive from '@/components/DashboardLive';

export default async function DashboardPage() {
  const [rooms, devices] = await Promise.all([
    serverApi.getRooms(),
    serverApi.getDevices(),
  ]);

  return (
    <DashboardLive initialDevices={devices} rooms={rooms} />
  );
}



