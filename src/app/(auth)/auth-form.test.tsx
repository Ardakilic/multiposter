// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthForm } from './auth-form';

vi.mock('./actions', () => ({}));
afterEach(cleanup);

describe('AuthForm', () => {
  it('submits email + password and shows the returned error', async () => {
    const action = vi.fn(async (_s: unknown, _f: FormData) => ({ error: 'Invalid credentials.' })); // eslint-disable-line @typescript-eslint/no-unused-vars
    render(<AuthForm action={action} label="Log in" />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    expect(screen.getByLabelText('Password')).toHaveProperty('autocomplete', 'current-password');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid credentials.');
    const fd = action.mock.calls[0][1];
    expect(Object.fromEntries(fd)).toEqual({ email: 'a@b.co', password: 'pw' });
  });

  it('uses new-password and minLength for registration', () => {
    render(<AuthForm action={vi.fn()} label="Create account" minPassword={8} />);
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveProperty('autocomplete', 'new-password');
    expect(pw).toHaveProperty('minLength', 8);
  });

  it('posts a hidden token with only the chosen fields and shows a returned message as status', async () => {
    const action = vi.fn(async (_s: unknown, _f: FormData) => ({ message: 'Done.' })); // eslint-disable-line @typescript-eslint/no-unused-vars
    render(<AuthForm action={action} label="Set password" fields={['password']} minPassword={8} token="tok" />);
    expect(screen.queryByLabelText('Email')).toBeNull();
    await userEvent.type(screen.getByLabelText('Password'), 'new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect((await screen.findByRole('status')).textContent).toBe('Done.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(Object.fromEntries(action.mock.calls[0][1])).toEqual({ token: 'tok', password: 'new-password' });
  });
});
