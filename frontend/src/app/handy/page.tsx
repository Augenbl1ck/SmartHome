import { existsSync } from 'fs';
import { join } from 'path';
import AppInstall from './AppInstall';

export default function AppPage() {
  const apkReady = existsSync(join(process.cwd(), 'public', 'downloads', 'smarthome.apk'));
  return <AppInstall apkReady={apkReady} />;
}
