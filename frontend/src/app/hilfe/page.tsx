import { readFileSync } from 'fs';
import { join } from 'path';
import Manual from '@/components/Manual';

export default function HilfePage() {
  const markdown = readFileSync(join(process.cwd(), '..', 'docs', 'bedienung.md'), 'utf8');
  return <Manual markdown={markdown} />;
}
