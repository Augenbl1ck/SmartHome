import { serverApi } from '@/lib/api-server';
import ScenesClient from './ScenesClient';

export const dynamic = 'force-dynamic';

export default async function ScenesPage() {
  const boot = await serverApi.getBootstrap().catch(() => ({ rooms: [], devices: [], scenes: [] }));

  return <ScenesClient initialScenes={boot.scenes} devices={boot.devices} />;
}
