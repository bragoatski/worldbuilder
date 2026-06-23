import { defineConfig } from 'vite';

// base must match the GitHub Pages project path so built asset URLs resolve at
// https://bragoatski.github.io/worldbuilder/
export default defineConfig({
  base: '/worldbuilder/',
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
