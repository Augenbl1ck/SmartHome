import { serverApi } from '@/lib/api-server';
import AutomationsClient from './AutomationsClient';

export default async function AutomationsPage() {
  const [automations, devices, rooms, logs, scenes] = await Promise.all([
    serverApi.getAutomations(),
    serverApi.getDevices(),
    serverApi.getRooms(),
    serverApi.getAutomationLogs(),
    serverApi.getScenes(),
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
