import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import sourceMaps from 'rollup-plugin-sourcemaps';
import typescript from 'rollup-plugin-typescript2';

export default {
  input: `janus-gateway-client.ts`,
  output: [
    { 
      file: './dist/index.js', 
      name: 'janus-gateway-client', 
      format: 'umd',
      sourcemap: false 
    }
  ],
  external: [],
  plugins: [
    typescript({ useTsconfigDeclarationDir: true }),
    commonjs(),
    resolve(),
    sourceMaps()
  ]
}
