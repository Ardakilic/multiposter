// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPost } from './actions';
import { ComposeForm } from './compose-form';

vi.mock('./actions', () => ({ createPost: vi.fn() }));
afterEach(cleanup);

const targets = [
  { id: 't1', label: 'main', accountName: '@me', connector: 'X', maxLength: 5 },
  { id: 't2', label: 'fedi', accountName: 'me@m', connector: 'Mastodon', maxLength: 10 },
];

describe('ComposeForm', () => {
  it('counts graphemes against the strictest selected limit', async () => {
    render(<ComposeForm targets={targets} />);
    const text = screen.getByLabelText('Post');
    await userEvent.type(text, '👨‍👩‍👧abcdef');
    const count = document.getElementById(text.getAttribute('aria-describedby')!)!;
    expect(count.textContent).toBe('7');
    await userEvent.click(screen.getByLabelText(/Mastodon · fedi/));
    expect(count.textContent).toBe('7 / 10');
    expect(count.className).not.toContain('text-red-600');
    await userEvent.click(screen.getByLabelText(/X · main/));
    expect(count.textContent).toBe('7 / 5');
    expect(count.className).toContain('text-red-600');
    await userEvent.click(screen.getByLabelText(/X · main/));
    expect(count.textContent).toBe('7 / 10');
  });

  it('adds and removes flood items, renumbering field names', async () => {
    render(<ComposeForm targets={targets} />);
    await userEvent.type(screen.getByLabelText('Post'), 'one');
    await userEvent.click(screen.getByRole('button', { name: 'Add post to flood' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add post to flood' }));
    await userEvent.type(screen.getByLabelText('Post 3'), 'three');
    await userEvent.click(screen.getByRole('button', { name: 'Remove post 2' }));
    expect(screen.getByLabelText('Post 2')).toHaveProperty('value', 'three');
    expect(screen.getByLabelText('Post 2')).toHaveProperty('name', 'items[1].text');
    await userEvent.click(screen.getByRole('button', { name: 'Remove post 1' }));
    expect(screen.getByLabelText('Post')).toHaveProperty('value', 'three');
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });

  it('shows an alt input per selected file and submits everything with a UTC schedule', async () => {
    const action = vi.mocked(createPost).mockResolvedValue({ error: 'a.pdf: unsupported\nb: too big' });
    render(<ComposeForm targets={targets} />);
    await userEvent.type(screen.getByLabelText('Post'), 'hello');
    await userEvent.upload(screen.getByLabelText('Media'), [
      new File(['x'], 'a.png', { type: 'image/png' }),
      new File(['y'], 'b.mp4', { type: 'video/mp4' }),
    ]);
    await userEvent.type(screen.getByLabelText('Alt text for a.png'), 'a cat');
    expect(screen.getByLabelText('Alt text for b.mp4')).toHaveProperty('name', 'items[0].alt[1]');
    await userEvent.click(screen.getByLabelText(/X · main/));
    await userEvent.click(screen.getByLabelText('Auto-split into threads when too long'));
    expect(screen.getByRole('button', { name: 'Post now' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/Schedule/), '2030-01-02T03:04');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));

    expect((await screen.findByRole('alert')).textContent).toBe('a.pdf: unsupported\nb: too big');
    const fd = action.mock.calls[0][1];
    expect(fd.get('items[0].text')).toBe('hello');
    // jsdom's FormData ignores files set by user-event, so check the input's name instead
    expect(screen.getByLabelText('Media')).toHaveProperty('name', 'items[0].files');
    expect(fd.get('items[0].alt[0]')).toBe('a cat');
    expect(fd.getAll('targets')).toEqual(['t1']);
    expect(fd.get('autoThread')).toBe('on');
    expect(fd.get('scheduledAt')).toBe(new Date('2030-01-02T03:04').toISOString());
    expect(screen.getByLabelText('Post')).toHaveProperty('value', 'hello'); // kept after an error

    await userEvent.upload(screen.getByLabelText('Media'), []);
    expect(screen.queryByLabelText(/Alt text/)).toBeNull();
  });

  it('disables submit while pending', async () => {
    vi.mocked(createPost).mockReturnValue(new Promise(() => {}));
    render(<ComposeForm targets={targets} />);
    await userEvent.click(screen.getByRole('button', { name: 'Post now' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toHaveProperty('disabled', true);
  });
});
