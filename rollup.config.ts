import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import sourceMaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript2';
import copy from 'rollup-plugin-copy';

export default {
  input: `janus-gateway-client.ts`,
  output: [
    {
      name: 'janus-gateway-client', 
      file: "dist/index.js",
      format: 'es',
      sourcemap: false
    }
  ],
  external: [],
  plugins: [
    typescript({ useTsconfigDeclarationDir: true }),
    commonjs(),
    resolve(),
    sourceMaps(),
    copy({
      targets: [
        { src: './package.json', dest: 'dist' },
        { src: './README.md', dest: 'dist' }
      ]
    })
  ]
}
