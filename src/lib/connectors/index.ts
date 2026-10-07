/** Connector registry, keyed by the `connector` id stored on each connection row. */

import { bluesky } from './bluesky';
import { instagram } from './instagram';
import { mastodon } from './mastodon';
import { nostr } from './nostr';
import type { Connector } from './types';
import { x } from './x';

export const connectors: Record<string, Connector> = { x, bluesky, mastodon, nostr, instagram };

/** Look up a connector; throws on unknown ids (own keys only, so `toString` etc. are rejected). */
export function getConnector(id: string): Connector {
  if (!Object.hasOwn(connectors, id)) throw new Error(`unknown connector: ${id}`);
  return connectors[id];
}
