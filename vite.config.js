import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readBuildIdentityFileSync, serializeBuildIdentity } from './shared/buildIdentity.js'
import { getConnectableHost, normalizeLoopbackHost } from './shared/networkHosts.js'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  const configuredHost = env.HOST || '0.0.0.0'
  // if the host is not a loopback address, it should be used directly. 
  // This allows the vite server to EXPOSE all interfaces when the host 
  // is set to '0.0.0.0' or '::', while still using 'localhost' for browser 
  // URLs and proxy targets.
  const host = normalizeLoopbackHost(configuredHost)
  
  const proxyHost = getConnectableHost(configuredHost)
  // TODO: Remove support for legacy PORT variables in all locations in a future major release, leaving only SERVER_PORT.
  const serverPort = env.SERVER_PORT || env.PORT || 3001
  const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
  const buildIdentity = readBuildIdentityFileSync(path.resolve('.build-identity', 'build-identity.json'), {
    expectedVersion: packageVersion,
    source: 'Canonical build identity',
  })
  if (env.CLOUDCLI_BUILD_ID && env.CLOUDCLI_BUILD_ID.trim() !== buildIdentity.buildId) {
    throw new Error('CLOUDCLI_BUILD_ID differs from the generated canonical build identity.')
  }

  return {
    plugins: [
      react(),
      {
        name: 'cloudcli-build-identity',
        apply: 'build',
        async closeBundle() {
          await fs.writeFile(path.resolve('dist', 'build-identity.json'), serializeBuildIdentity(buildIdentity), 'utf8')
          await fs.writeFile(path.resolve('dist', 'build-id.txt'), `${buildIdentity.buildId}\n`, 'utf8')
          const serviceWorkerPath = path.resolve('dist', 'sw.js')
          const serviceWorkerMarker = 'const EMBEDDED_BUILD_ID = null;'
          const serviceWorkerSource = await fs.readFile(serviceWorkerPath, 'utf8')
          if (serviceWorkerSource.split(serviceWorkerMarker).length !== 2) {
            throw new Error('Service worker build identity injection marker is missing or duplicated.')
          }
          await fs.writeFile(
            serviceWorkerPath,
            serviceWorkerSource.replace(
              serviceWorkerMarker,
              `const EMBEDDED_BUILD_ID = ${JSON.stringify(buildIdentity.buildId)};`,
            ),
            'utf8',
          )
        }
      }
    ],
    define: {
      'globalThis.__CLOUDCLI_BUILD_ID__': JSON.stringify(buildIdentity.buildId),
      'globalThis.__CLOUDCLI_VERSION__': JSON.stringify(buildIdentity.version)
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    server: {
      host,
      port: parseInt(env.VITE_PORT) || 5173,
      proxy: {
        '/api': `http://${proxyHost}:${serverPort}`,
        '/ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/shell': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/plugin-ws': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        },
        '/voice-stream': {
          target: `ws://${proxyHost}:${serverPort}`,
          ws: true
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@codemirror/lang-css',
              '@codemirror/lang-html',
              '@codemirror/lang-javascript',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/theme-one-dark'
            ],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-clipboard', '@xterm/addon-webgl']
          }
        }
      }
    }
  }
})
