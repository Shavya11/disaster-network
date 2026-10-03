// `npm run local`: API + web app on this machine against the production database — no Docker, no Render wait.
// Needs apps/api/.env.production (git-ignored; ask the backend owner). Ctrl+C stops both.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('apps/api/.env.production')) {
  console.error('Missing apps/api/.env.production — it holds the production database credentials.');
  process.exit(1);
}

const procs = [
  ['api', 'npm run dev:prod -w @dn/api'],
  ['web', 'npm run dev:prod -w @dn/web'],
].map(([name, cmd]) => {
  const p = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  p.stdout.on('data', (c) => process.stdout.write(tag(c)));
  p.stderr.on('data', (c) => process.stderr.write(tag(c)));
  p.on('exit', (code) => {
    console.log(`[${name}] exited (${code}); stopping.`);
    process.exit(code ?? 0);
  });
  return p;
});

console.log('Starting… open http://localhost:5173 once both are up.');
process.on('SIGINT', () => {
  for (const p of procs) p.kill();
  process.exit(0);
});
