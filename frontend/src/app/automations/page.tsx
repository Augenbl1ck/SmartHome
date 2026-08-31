import { serverApi } from '@/lib/api-server';
import AutomationsClient from './AutomationsClient';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage() {
  const [automations, devices, rooms, logs, scenes] = await Promise.all([
    serverApi.getAutomations().catch(() => []),
    serverApi.getDevices().catch(() => []),
    serverApi.getRooms().catch(() => []),
    serverApi.getAutomationLogs().catch(() => []),
    serverApi.getScenes().catch(() => []),
  ]);

  return (
    <AutomationsClient
      initialAutomations={automations}
      devices={devices}
      rooms={rooms}
      scenes={scenes}
      initialLogs={logs}
    />
  );
}
