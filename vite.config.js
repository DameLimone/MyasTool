import { defineConfig, loadEnv } from 'vite';
import { squareMiddleware } from './server/square.js';
import { backendMiddleware } from './server/backend/local-middleware.js';

export default defineConfig(({ mode }) => {
  const loadBackendEnv = (prefix) => loadEnv(mode, process.cwd(), prefix);
  const backendEnv = {
    ...loadBackendEnv('CLERK_'),
    POSTGRES_URL: loadBackendEnv('POSTGRES_URL').POSTGRES_URL,
  };
  return {
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    plugins: [{ name: 'local-api', configureServer(server) {
      server.middlewares.use(squareMiddleware(loadEnv(mode, process.cwd(), 'SQUARE_')));
      server.middlewares.use(backendMiddleware(backendEnv));
    } }],
  };
});
