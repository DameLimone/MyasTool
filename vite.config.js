import { defineConfig, loadEnv } from 'vite';
import { squareMiddleware } from './server/square.js';

export default defineConfig(({ mode }) => ({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  plugins: [{ name: 'local-square', configureServer(server) {
    server.middlewares.use(squareMiddleware(loadEnv(mode, process.cwd(), 'SQUARE_')));
  } }],
}));
