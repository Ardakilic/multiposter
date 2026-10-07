'use client';

/** Client form to add a connection; fields are rendered from the selected connector's `fields`. */

import { startTransition, useActionState, useState } from 'react';
import type { Capabilities, Field } from '@/lib/connectors/types';
import { addConnection } from './actions';

export type ConnectorMeta = { id: string; name: string; fields: Field[]; capabilities: Capabilities; maxLength: number };

export function ConnectForm({ connectors }: { connectors: ConnectorMeta[] }) {
  const [state, action, pending] = useActionState(addConnection, undefined);
  const [selected, setSelected] = useState(connectors[0].id);
  const c = connectors.find((x) => x.id === selected)!;

  return (
    <form
      key={state?.saved} // remount (clear inputs) only after a successful save; errors keep what was typed
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-3"
    >
      <label className="field">
        Platform
        <select name="connector" value={selected} onChange={(e) => setSelected(e.target.value)} className="input">
          {connectors.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-neutral-500">
        Up to {c.maxLength} characters, {c.capabilities.maxMedia} media per post
        {c.capabilities.video ? ', video supported' : ', no video'}
        {c.capabilities.threads ? ', threads supported' : ', no threads'}
        {c.capabilities.textOnly ? '' : ', media required'}.
      </p>
      <label className="field">
        Label
        <input name="label" required maxLength={100} placeholder="e.g. personal" className="input" />
      </label>
      {c.fields.map((f) => (
        <div key={`${c.id}.${f.name}`} className="flex flex-col gap-1">
          <label className="field">
            {f.label}
            <input
              name={`field.${f.name}`}
              type={f.secret ? 'password' : 'text'}
              required={f.required}
              placeholder={f.placeholder}
              autoComplete="off"
              aria-describedby={f.help ? `help-${f.name}` : undefined}
              className="input"
            />
          </label>
          {f.help && (
            <p id={`help-${f.name}`} className="text-sm text-neutral-500">
              {f.help}
            </p>
          )}
        </div>
      ))}
      {state?.error && (
        <p role="alert" className="text-red-600">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn self-start">
        {pending ? 'Verifying…' : 'Connect'}
      </button>
    </form>
  );
}
