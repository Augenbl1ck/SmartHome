import { serverApi } from '@/lib/api-server';
import AutomationsClient from './AutomationsClient';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage() {
  const [boot, automations, logs] = await Promise.all([
    serverApi.getBootstrap().catch(() => ({ rooms: [], devices: [], scenes: [] })),
    serverApi.getAutomations().catch(() => []),
    serverApi.getAutomationLogs().catch(() => []),
  ]);

  return (
    <AutomationsClient
      initialAutomations={automations}
      devices={boot.devices}
      rooms={boot.rooms}
      scenes={boot.scenes}
      initialLogs={logs}
    />
  );
}
