/**
 * The connector contract every platform implements. Credentials are flat string maps (encrypted at rest);
 * `Ref` is the opaque handle a connector returns and later receives back as `root`/`parent` to thread replies.
 */

export type Ref = Record<string, string>; // opaque reply handle: {id} or {uri,cid}

export interface MediaFile {
  key: string;
  mime: string;
  size: number;
  alt?: string;
  bytes(): Promise<Buffer>;
  url(): Promise<string>;
}

export interface Field {
  name: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  help?: string;
  placeholder?: string;
}

export interface Capabilities {
  images: boolean;
  video: boolean;
  threads: boolean;
  textOnly: boolean;
  maxMedia: number;
}

export interface Connector<C extends Record<string, string> = Record<string, string>, S = Record<string, unknown>> {
  id: string;
  name: string;
  fields: Field[];
  capabilities: Capabilities;
  maxLength(settings: S): number;
  countLength(text: string): number;
  verify(creds: C): Promise<{ accountName: string; settings: S }>; // at connect time; throws on bad creds
  post(ctx: { creds: C; settings: S; text: string; media: MediaFile[]; root?: Ref; parent?: Ref }): Promise<{
    id: string;
    url?: string;
    ref: Ref;
  }>;
}
