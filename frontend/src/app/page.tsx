import { serverApi } from '@/lib/api-server';
import DashboardLive from '@/components/DashboardLive';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const boot = await serverApi.getBootstrap().catch(() => ({ rooms: [], devices: [], scenes: [] }));

  return (
    <DashboardLive
      initialDevices={boot.devices}
      rooms={boot.rooms}
      initialScenes={boot.scenes}
    />
  );
}
