import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

const root = new URL('..', import.meta.url).pathname
const out = `${root}/lib`
await mkdir(out, { recursive: true })

await build({
  entryPoints: [`${root}/src/host/index.ts`],
  outfile: `${out}/index.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
})

// Platform seed words (see dsh-client-modules `staticModules`): the shell owns these
// instances, so the bundle must require them instead of shipping a second copy. zod is
// deliberately NOT here: the seed only names the bare specifier, while OpenUI imports
// `zod/v4`, so externalising it would either split the instance or miss the seed word.
const seeded = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
]

// Peers that only unused code paths reach: stub them rather than install them.
const stub = {
  name: 'stub-unused-peers',
  setup(b) {
    const empty = { contents: 'export default {}', loader: 'js' }
    for (const spec of ['react-native', '@modelcontextprotocol/sdk']) {
      b.onResolve({ filter: new RegExp(`^${spec}`) }, () => ({ path: spec, namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => empty)
    }
  },
}

const client = await build({
  entryPoints: [`${root}/src/client/index.tsx`],
  bundle: true,
  write: false,
  minify: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  external: seeded,
  loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [stub],
  logLevel: 'info',
})

const code = client.outputFiles[0].text
const wrapped = `window.__ModuleLoader__.load({
  id: "dsh-genui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${code}
    return module.exports;
  },
});
`
await writeFile(`${out}/client.js`, wrapped)
console.log('built lib/index.js and lib/client.js')
