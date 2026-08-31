import { serverApi } from '@/lib/api-server';
import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [rooms, devices] = await Promise.all([
    serverApi.getRooms().catch(() => []),
    serverApi.getDevices().catch(() => []),
  ]);

  return <SettingsClient initialRooms={rooms} initialDevices={devices} />;
}
