import { serverApi } from '@/lib/api-server';
import SettingsClient from './SettingsClient';

export default async function SettingsPage() {
  const [rooms, devices] = await Promise.all([
    serverApi.getRooms(),
    serverApi.getDevices(),
  ]);

  return <SettingsClient initialRooms={rooms} initialDevices={devices} />;
}
