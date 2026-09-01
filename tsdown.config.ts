/**
 * tsdown config for dsh-righthand - the client bundle only.
 * The host half (lib/index.js + d.ts) is produced by tsc (tsconfig.build.json);
 * this config builds the browser panel bundle at lib/client.js following the
 * harness client-bundle contract: CJS wrapped as a window.__ModuleLoader__
 * closure with react external (a shell-seeded platform module).
 */
import { defineConfig } from 'tsdown'

const CLIENT_ID = '@try-works/dsh-righthand'

const isClientExternal = (specifier: string): boolean =>
  specifier === 'react' || specifier.startsWith('react/')
  || specifier === 'react-dom' || specifier.startsWith('react-dom/')

const client = defineConfig({
  name: CLIENT_ID + '/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isClientExternal,
    alwaysBundle: (specifier: string) => !isClientExternal(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(CLIENT_ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})

export default [client]