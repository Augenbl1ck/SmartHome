import { serverApi } from '@/lib/api-server';
import ScenesClient from './ScenesClient';

export const dynamic = 'force-dynamic';

export default async function ScenesPage() {
  const [scenes, devices] = await Promise.all([
    serverApi.getScenes().catch(() => []),
    serverApi.getDevices().catch(() => []),
  ]);

  return <ScenesClient initialScenes={scenes} devices={devices} />;
}
