import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup(): Promise<void> {
  execFileSync(process.execPath, [path.join(here, 'make-fixtures.mjs')], {
    stdio: 'inherit',
    env: process.env,
  });
}
