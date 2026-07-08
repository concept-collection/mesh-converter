/**
 * Share links: the loaded mesh — as the original file bytes in its original
 * format — plus viewer state, packed into the URL fragment. Container layout
 * before compression is [u32 LE header length][JSON header][file bytes];
 * that is deflate-raw compressed and base64url-encoded after "#share=".
 * The fragment stays in the browser — nothing is uploaded anywhere.
 *
 * This module is deliberately dependency-free (no DOM imports beyond what
 * Node also provides) so the codec can be exercised outside the browser.
 */

export interface SharePayload {
  /** Base filename without extension */
  name: string
  /** meshio format id of `bytes`, or null for the built-in sample mesh */
  formatId: string | null
  exportFormatId: string
  viewMode: string
  /** Original file bytes (empty when formatId is null) */
  bytes: Uint8Array<ArrayBuffer>
}

const HASH_PREFIX = '#share='

/**
 * Longest URL we are willing to produce. Browsers themselves accept far
 * longer, but links beyond roughly 64k characters commonly get truncated or
 * de-linkified by messengers, email clients, and older tooling.
 */
export const MAX_SHARE_URL_CHARS = 65000

interface ShareHeader {
  v: number
  name: string
  format: string | null
  export: string
  view: string
}

async function pipeThrough(
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000 // keep String.fromCharCode argument counts sane
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string): Uint8Array<ArrayBuffer> {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function encodeShare(payload: SharePayload): Promise<string> {
  const header: ShareHeader = {
    v: 1,
    name: payload.name,
    format: payload.formatId,
    export: payload.exportFormatId,
    view: payload.viewMode,
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const container = new Uint8Array(4 + headerBytes.length + payload.bytes.length)
  new DataView(container.buffer).setUint32(0, headerBytes.length, true)
  container.set(headerBytes, 4)
  container.set(payload.bytes, 4 + headerBytes.length)
  const compressed = await pipeThrough(container, new CompressionStream('deflate-raw'))
  return toBase64Url(compressed)
}

export async function decodeShare(encoded: string): Promise<SharePayload> {
  let container: Uint8Array<ArrayBuffer>
  try {
    container = await pipeThrough(fromBase64Url(encoded), new DecompressionStream('deflate-raw'))
  } catch {
    throw new Error('the share data in the URL is damaged or truncated')
  }
  if (container.length < 4) throw new Error('the share data in the URL is truncated')
  const headerLength = new DataView(container.buffer, container.byteOffset, 4).getUint32(0, true)
  if (4 + headerLength > container.length) {
    throw new Error('the share data in the URL is truncated')
  }
  let header: ShareHeader
  try {
    header = JSON.parse(new TextDecoder().decode(container.subarray(4, 4 + headerLength)))
  } catch {
    throw new Error('the share data in the URL is not valid')
  }
  if (header.v !== 1 || typeof header.name !== 'string' || typeof header.export !== 'string') {
    throw new Error('this share link was made by an incompatible version of the app')
  }
  return {
    name: header.name,
    formatId: header.format ?? null,
    exportFormatId: header.export,
    viewMode: header.view,
    bytes: container.slice(4 + headerLength),
  }
}

/** Full shareable URL for the current page, e.g. "https://…/index.html#share=…". */
export async function buildShareUrl(payload: SharePayload): Promise<string> {
  const base = window.location.href.split('#')[0]
  return base + HASH_PREFIX + (await encodeShare(payload))
}

/** Decode a location.hash; null if it is not a share link. */
export async function parseShareHash(hash: string): Promise<SharePayload | null> {
  if (!hash.startsWith(HASH_PREFIX)) return null
  return decodeShare(hash.slice(HASH_PREFIX.length))
}
