import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const pagesBase = repository ? `/${repository}/` : '/';
const configuredBase = process.env.VITE_BASE_URL || pagesBase;

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? configuredBase : '/',
});
