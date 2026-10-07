import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from './lib/db/client';
import { start } from './lib/publish/worker';
import { ensureBucket } from './lib/storage';
import { register } from './instrumentation';

vi.mock('./lib/db/client', async (orig) => ({ ...(await orig<object>()), migrate: vi.fn() }));
vi.mock('./lib/storage', async (orig) => ({ ...(await orig<object>()), ensureBucket: vi.fn() }));
vi.mock('./lib/publish/worker', () => ({ start: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('register', () => {
  it('does nothing outside the nodejs runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(migrate).not.toHaveBeenCalled();
  });

  it('migrates and ensures the bucket; starts the worker only when enabled', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    expect(migrate).toHaveBeenCalledOnce();
    expect(ensureBucket).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled(); // WORKER_ENABLED=false in tests

    vi.stubEnv('WORKER_ENABLED', 'true');
    const { resetConfig } = await import('./lib/config');
    resetConfig();
    await register();
    expect(start).toHaveBeenCalledOnce();
  });
});
