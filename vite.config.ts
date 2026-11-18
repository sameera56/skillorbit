import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // The website and Express API are served from the same Render origin, so web builds
  // should use relative /api requests. Only the Android WebView needs an absolute API URL.
  const apiBase = mode === 'android' ? (env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '') : ''
  if (mode === 'android') {
    let target: URL | undefined
    try { target = new URL(apiBase) } catch { /* handled below */ }
    if (!target || target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || /(^|\.)(localhost|example\.com|example\.org|example\.net|invalid|test)$/i.test(target.hostname)) {
      throw new Error('Set VITE_API_BASE_URL to your production HTTPS SkillOrbit origin (without a path) before building Android.')
    }
  }
  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBase),
      'import.meta.env.VITE_CAPACITOR': JSON.stringify(mode === 'android'),
    },
    server: {
      proxy: {
        '/api': 'http://localhost:5000',
      },
    },
  }
})
