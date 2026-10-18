// WebAuthn glue. The server speaks the JSON form of the WebAuthn options
// (base64url strings); the browser APIs want ArrayBuffers.

function b64urlToBuf(s: string): ArrayBuffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function bufToB64url(b: ArrayBuffer): string {
  let s = ''
  for (const byte of new Uint8Array(b)) s += String.fromCharCode(byte)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && 'PublicKeyCredential' in window
}

/** True when the user cancelled or dismissed the OS prompt. */
export function wasCancelled(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')
}

function descriptors(list?: { id: string; type: string; transports?: string[] }[]) {
  return list?.map((c) => ({ ...c, id: b64urlToBuf(c.id) })) as PublicKeyCredentialDescriptor[] | undefined
}

/** Runs navigator.credentials.create() and returns the JSON body the server expects. */
export async function createPasskey(options: any): Promise<unknown> {
  const pk = options.publicKey
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...pk,
      challenge: b64urlToBuf(pk.challenge),
      user: { ...pk.user, id: b64urlToBuf(pk.user.id) },
      excludeCredentials: descriptors(pk.excludeCredentials),
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('No passkey was created')
  const r = cred.response as AuthenticatorAttestationResponse
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufToB64url(r.clientDataJSON),
      attestationObject: bufToB64url(r.attestationObject),
      transports: r.getTransports?.() ?? [],
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  }
}

/** Runs navigator.credentials.get() and returns the JSON body the server expects. */
export async function getPasskey(options: any): Promise<unknown> {
  const pk = options.publicKey
  const cred = (await navigator.credentials.get({
    publicKey: {
      ...pk,
      challenge: b64urlToBuf(pk.challenge),
      allowCredentials: descriptors(pk.allowCredentials),
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('No passkey was selected')
  const r = cred.response as AuthenticatorAssertionResponse
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufToB64url(r.clientDataJSON),
      authenticatorData: bufToB64url(r.authenticatorData),
      signature: bufToB64url(r.signature),
      userHandle: r.userHandle ? bufToB64url(r.userHandle) : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  }
}
