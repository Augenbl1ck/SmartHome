import { serverApi } from '@/lib/api-server';
import AutomationsClient from './AutomationsClient';

export default async function AutomationsPage() {
  const [automations, devices, rooms] = await Promise.all([
    serverApi.getAutomations(),
    serverApi.getDevices(),
    serverApi.getRooms(),
  ]);

  return (
    <AutomationsClient
      initialAutomations={automations}
      devices={devices}
      rooms={rooms}
    />
  );
}
