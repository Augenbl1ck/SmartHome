import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import AppInstall from './AppInstall';

export default function AppPage() {
  const apkReady = existsSync(join(process.cwd(), 'public', 'downloads', 'smarthome.apk'));
  const watchReady = existsSync(join(process.cwd(), 'public', 'downloads', 'smarthome-watch.apk'));
  let versionCode = 0;
  const versionPath = join(process.cwd(), '..', 'mobile', 'app-version.json');
  if (existsSync(versionPath)) {
    try {
      versionCode = Number(JSON.parse(readFileSync(versionPath, 'utf8')).versionCode) || 0;
    } catch {
      versionCode = 0;
    }
  }
  return <AppInstall apkReady={apkReady} watchReady={watchReady} versionCode={versionCode} />;
}
