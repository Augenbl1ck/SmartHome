import { serverApi } from '@/lib/api-server';
import DashboardLive from '@/components/DashboardLive';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // Nur lokale, schnelle Daten blockieren die Startseite.
  // Kalender / Wetter / Bahn / Energie laden die Widgets selbst (parallel, mit Skeleton).
  const [rooms, devices, scenes] = await Promise.all([
    serverApi.getRooms().catch(() => []),
    serverApi.getDevices().catch(() => []),
    serverApi.getScenes().catch(() => []),
  ]);

  return (
    <DashboardLive
      initialDevices={devices}
      rooms={rooms}
      initialScenes={scenes}
    />
  );
}
