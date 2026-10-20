import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { createRequire, Module } from 'node:module';

let compilation = 0;

// Each fixture has its own module graph. No global require hooks or production test flags.
export function backendLoader(
  stubs: Record<string, unknown> = {},
  globals: Record<string, unknown> = {},
) {
  const cache = new Map<string, any>();
  function load(filename: string): any {
    filename = resolve(filename);
    if (filename in stubs) return stubs[filename];
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename);
    cache.set(filename, mod);
    mod.filename = filename;
    const native = createRequire(filename);
    mod.require = ((name: string) => {
      if (name === 'fixture:globals') return globals;
      if (name in stubs) return stubs[name];
      if (name.startsWith('.') || isAbsolute(name)) {
        const target = resolve(dirname(filename), name);
        const source = [target, target + '.ts', target + '/index.ts'].find(
          (p) => p.endsWith('.ts') && existsSync(p),
        );
        if (source) return load(source);
        if (target in stubs) return stubs[target];
      }
      return native(name);
    }) as typeof mod.require;
    const compile = (mod as any)._compile.bind(mod);
    (mod as any)._compile = (code: string) => {
      // Preserve Node's normal CJS coverage offsets and shift the source map for the fixture prelude.
      code = code.replace(
        /(sourceMappingURL=data:application\/json;base64,)([^\s]+)/,
        (_, prefix, encoded) => {
          const map = JSON.parse(Buffer.from(encoded, 'base64').toString());
          map.mappings = ';' + map.mappings;
          return prefix + Buffer.from(JSON.stringify(map)).toString('base64');
        },
      );
      const bindings = Object.keys(globals).length
        ? `const { ${Object.keys(globals).join(', ')} } = require('fixture:globals');`
        : '';
      code = `__dirname = ${JSON.stringify(dirname(filename))}; ${bindings}\n` + code;
      mod.filename = resolve(
        'coverage/.backend-fixtures',
        String(process.pid),
        String(++compilation) + '.cjs',
      );
      // c8 reads these files after the test worker exits to remap V8 coverage.
      if (process.env.NODE_V8_COVERAGE) {
        mkdirSync(dirname(mod.filename), { recursive: true });
        writeFileSync(mod.filename, code);
      }
      compile(code, mod.filename);
    };
    native.extensions['.ts']!(mod, filename);
    return mod.exports;
  }
  return load;
}
