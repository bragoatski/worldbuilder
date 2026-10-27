import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';

// Dev only: start the visit relay (visit/relay.mjs) beside the dev server, so the page can offer
// "Call Root". If a relay is already running, the new one bows out. Never part of the Pages build.
function visitRelay() {
  return {
    name: 'visit-relay',
    apply: 'serve',
    configureServer() {
      if (process.env.VITEST) return;   // tests run Vite in serve mode too; a relay would keep them from exiting
      const relay = spawn(process.execPath, ['visit/relay.mjs'], { stdio: 'inherit' });
      // The guest link (Ketch'em mechanics 26) beside it: both its ports on 127.0.0.1 unless the owner sets GUEST_HOST,
      // so the page's "+ guest on another screen" works without a second command. A link already running bows out.
      const link = spawn(process.execPath, ['visit/guest-link.mjs'], { stdio: 'inherit' });
      process.on('exit', () => { relay.kill(); link.kill(); });
    },
  };
}

// base must match the GitHub Pages project path so built asset URLs resolve at
// https://bragoatski.github.io/worldbuilder/
export default defineConfig({
  base: '/worldbuilder/',
  plugins: [visitRelay()],
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
