import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'cjs',
    inlineDynamicImports: true,
  },
  external: ['@homebridge/node-pty-prebuilt-multiarch'],
  plugins: [
    json(),
    nodeResolve({ exportConditions: ['node'] }),
    typescript({
      exclude: ['**/*.test.ts', '**/*.d.ts', 'test']
    }),
    commonjs(),
    terser()
  ]
}
