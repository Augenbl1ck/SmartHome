import { serverApi } from '@/lib/api-server';
import ScenesClient from './ScenesClient';

export default async function ScenesPage() {
  const [scenes, devices] = await Promise.all([
    serverApi.getScenes(),
    serverApi.getDevices(),
  ]);

  return <ScenesClient initialScenes={scenes} devices={devices} />;
}
