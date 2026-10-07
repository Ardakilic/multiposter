// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectors } from '@/lib/connectors';
import { addConnection } from './actions';
import { ConnectForm } from './connect-form';

vi.mock('./actions', () => ({ addConnection: vi.fn() }));
afterEach(cleanup);

const meta = Object.values(connectors).map((c) => ({
  id: c.id,
  name: c.name,
  fields: c.fields,
  capabilities: c.capabilities,
  maxLength: c.maxLength({}),
}));

describe('ConnectForm', () => {
  it('renders fields for the selected connector, with secrets as password inputs and help text', async () => {
    render(<ConnectForm connectors={meta} />);
    expect(screen.getByLabelText('API key')).toHaveProperty('type', 'text');
    expect(screen.getByLabelText('API secret')).toHaveProperty('type', 'password');
    expect(screen.getByText(/pay-per-use/)).toBeTruthy();
    expect(screen.getByText(/280 characters, 4 media per post, video supported, threads supported\./)).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText('Platform'), 'instagram');
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(screen.getByLabelText('Instagram user ID')).toHaveProperty('required', true);
    expect(screen.getByText(/no threads, media required\./)).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText('Platform'), 'bluesky');
    expect(screen.getByText(/no video/)).toBeTruthy();
    expect(screen.getByLabelText('Service')).toHaveProperty('required', false);
    expect(screen.getByLabelText('Service').getAttribute('aria-describedby')).toBe('help-service');
  });

  it('submits field values, shows errors and keeps input; clears after save', async () => {
    const action = vi.mocked(addConnection);
    action.mockResolvedValueOnce({ error: 'Mastodon GET failed: 401' }).mockResolvedValueOnce({ saved: 1 });
    render(<ConnectForm connectors={meta} />);
    await userEvent.selectOptions(screen.getByLabelText('Platform'), 'mastodon');
    await userEvent.type(screen.getByLabelText('Label'), 'main');
    await userEvent.type(screen.getByLabelText('Instance URL'), 'https://m.example');
    await userEvent.type(screen.getByLabelText('Access token'), 'tok');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Mastodon GET failed: 401');
    expect(Object.fromEntries(action.mock.calls[0][1])).toEqual({
      connector: 'mastodon',
      label: 'main',
      'field.host': 'https://m.example',
      'field.accessToken': 'tok',
    });
    expect(screen.getByLabelText('Label')).toHaveProperty('value', 'main');

    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await vi.waitFor(() => expect(screen.getByLabelText('Label')).toHaveProperty('value', ''));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Platform')).toHaveProperty('value', 'mastodon');
  });
});
