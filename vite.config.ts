import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Content-Security-Policy: aplikace smí načítat jen své vlastní soubory a nesmí nic
 * odesílat (connect-src 'self'). Vkládá se jen do produkčního sestavení, protože
 * vývojový server Vite potřebuje inline skripty a WebSocket.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'logistics-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
        ),
    },
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  // Relativní cesty: funguje na https://<uživatel>.github.io/logistics/ i lokálně.
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    sourcemap: true,
    // Dvě samostatné stránky: logistická aplikace (index.html) a pokrytí materiálu (material.html).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        material: fileURLToPath(new URL('./material.html', import.meta.url)),
      },
    },
  },
});
