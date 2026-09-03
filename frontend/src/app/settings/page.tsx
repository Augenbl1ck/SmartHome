import { serverApi } from '@/lib/api-server';
import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const boot = await serverApi.getBootstrap().catch(() => ({ rooms: [], devices: [], scenes: [] }));

  return <SettingsClient initialRooms={boot.rooms} initialDevices={boot.devices} />;
}
