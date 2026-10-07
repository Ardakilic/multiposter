'use client';

/**
 * Client compose form: one or more thread items, each with text and media, plus target picker.
 * The counter shows the strictest limit among selected targets; the server re-validates everything.
 */

import { startTransition, useActionState, useState } from 'react';
import { graphemes } from '@/lib/text/count';
import { createPost } from './actions';

export type Target = { id: string; label: string; accountName: string; connector: string; maxLength: number };
type Item = { key: number; text: string; files: string[] };

let nextKey = 1;

export function ComposeForm({ targets }: { targets: Target[] }) {
  const [state, action, pending] = useActionState(createPost, undefined);
  const [items, setItems] = useState<Item[]>([{ key: 0, text: '', files: [] }]);
  const [selected, setSelected] = useState<string[]>([]);
  const [local, setLocal] = useState('');

  const limits = targets.filter((t) => selected.includes(t.id)).map((t) => t.maxLength);
  const limit = limits.length ? Math.min(...limits) : undefined;
  const update = (key: number, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <form
      // onSubmit instead of action={...}: a form action resets every input (text, files) even when the server returns an error
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-6"
    >
      <ol className="flex flex-col gap-4">
        {items.map((item, i) => {
          const n = graphemes(item.text);
          const over = limit !== undefined && n > limit;
          return (
            <li key={item.key} className="flex flex-col gap-2 rounded border border-neutral-300 p-3">
              <label className="field">
                {items.length > 1 ? `Post ${i + 1}` : 'Post'}
                <textarea
                  name={`items[${i}].text`}
                  rows={4}
                  value={item.text}
                  onChange={(e) => update(item.key, { text: e.target.value })}
                  aria-describedby={`count-${item.key}`}
                  className="input font-normal"
                />
              </label>
              <p id={`count-${item.key}`} className={`text-right text-sm ${over ? 'font-semibold text-red-600' : 'text-neutral-500'}`}>
                {n}
                {limit !== undefined && ` / ${limit}`}
              </p>
              <label className="field">
                Media
                <input
                  name={`items[${i}].files`}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime"
                  onChange={(e) => update(item.key, { files: [...e.target.files!].map((f) => f.name) })}
                  className="font-normal"
                />
              </label>
              {item.files.map((name, j) => (
                <label key={j} className="field">
                  Alt text for {name}
                  <input name={`items[${i}].alt[${j}]`} maxLength={1500} className="input font-normal" />
                </label>
              ))}
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setItems((xs) => xs.filter((x) => x.key !== item.key))}
                  className="self-start text-sm text-red-600 underline"
                >
                  Remove post {i + 1}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => setItems((xs) => [...xs, { key: nextKey++, text: '', files: [] }])}
        className="self-start underline"
      >
        Add post to flood
      </button>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Post to</legend>
        {targets.map((t) => (
          <label key={t.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              name="targets"
              value={t.id}
              checked={selected.includes(t.id)}
              onChange={(e) => setSelected((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))}
            />
            {t.connector} · {t.label} <span className="text-neutral-500">({t.accountName}, max {t.maxLength})</span>
          </label>
        ))}
      </fieldset>

      <label className="flex items-center gap-2">
        <input type="checkbox" name="autoThread" />
        Auto-split into threads when too long
      </label>

      <label className="field">
        Schedule (optional, your local time; empty = post now)
        <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} className="input self-start font-normal" />
      </label>
      <input type="hidden" name="scheduledAt" value={local ? new Date(local).toISOString() : ''} />

      {state?.error && (
        <p role="alert" className="whitespace-pre-line text-red-600">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn self-start">
        {pending ? 'Saving…' : local ? 'Schedule' : 'Post now'}
      </button>
    </form>
  );
}
