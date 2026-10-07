import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jar, loginAs } from '../../test/next';
import RootLayout, { generateMetadata } from './layout';
import Home from './page';

vi.mock('next/headers', async () => (await import('../../test/next')).headers);
vi.mock('next/navigation', async () => (await import('../../test/next')).navigation);
vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }));
vi.mock('./globals.css', () => ({}));

const layout = async () =>
  renderToStaticMarkup(await RootLayout({ children: 'hi', params: Promise.resolve({}) } as never));

beforeEach(() => jar.clear());

describe('app shell', () => {
  it('home redirects to /compose', () => {
    expect(() => Home()).toThrow('REDIRECT /compose');
  });

  it('uses APP_NAME as title', async () => {
    vi.stubEnv('APP_NAME', 'Poster');
    expect(await generateMetadata()).toEqual({ title: 'Poster' });
    vi.unstubAllEnvs();
  });

  it('anonymous layout shows only the app name', async () => {
    const html = await layout();
    expect(html).toContain('Multiposter');
    expect(html).toContain('hi');
    expect(html).not.toContain('Log out');
  });

  it('logged-in layout shows nav and logout', async () => {
    await loginAs();
    const html = await layout();
    for (const s of ['/compose', '/posts', '/connections', 'Log out']) expect(html).toContain(s);
  });
});
