import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  server: {
    fs: {
      // script.js fica na raiz do repositório, um nível acima desta pasta de
      // testes — sem isso o Vite recusa carregar arquivos "fora do projeto".
      allow: [path.resolve(__dirname, '..')]
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./setup.js'],
    // Cada arquivo de teste roda em seu próprio contexto/módulo isolado,
    // então o estado (let routes/points/etc do script.js) não vaza entre arquivos.
    isolate: true,
    testTimeout: 10000
  }
});
