import { serverApi } from '@/lib/api-server';
import AutomationsClient from './AutomationsClient';

export default async function AutomationsPage() {
  const [automations, devices, rooms, logs] = await Promise.all([
    serverApi.getAutomations(),
    serverApi.getDevices(),
    serverApi.getRooms(),
    serverApi.getAutomationLogs(),
  ]);

  return (
    <AutomationsClient
      initialAutomations={automations}
      devices={devices}
      rooms={rooms}
      initialLogs={logs}
    />
  );
}
