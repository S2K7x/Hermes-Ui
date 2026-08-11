/**
 * Web Push encryption — RFC 8291 (aes128gcm) and RFC 8292 (VAPID).
 *
 * Written against `node:crypto` rather than pulling in a dependency: the whole
 * scheme is four HMACs, one ECDH and one AES-GCM call, and every step of it is
 * pinned by the test vector in RFC 8291 §5 (`tests/push-crypto.test.ts` checks
 * the shared secret, PRK, CEK, nonce, header and ciphertext against the
 * published values). Crypto nobody can verify is crypto nobody should write —
 * this one is verifiable, byte for byte.
 *
 * Nothing here reads configuration or touches the database, which is also what
 * lets the tests import it directly under `node --test`.
 */

import {
	createCipheriv,
	createECDH,
	createHmac,
	createPrivateKey,
	randomBytes,
	sign
} from 'node:crypto';

const b64url = (buf: Buffer | Uint8Array): string => Buffer.from(buf).toString('base64url');
const fromB64url = (value: string): Buffer => Buffer.from(value, 'base64url');

const hmac = (key: Buffer, data: Buffer): Buffer =>
	createHmac('sha256', key).update(data).digest();

/**
 * HKDF-SHA256 as RFC 8291 uses it: always a single output block, so Expand is
 * one HMAC over `info || 0x01` and never loops.
 */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
	if (length > 32) throw new Error('hkdf: single-block only');
	return hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

export interface PushKeys {
	/** Subscription public key (`keys.p256dh`), base64url, uncompressed P-256. */
	p256dh: string;
	/** Subscription auth secret (`keys.auth`), base64url, 16 octets. */
	auth: string;
}

export interface EncryptOptions {
	/** 16-octet salt. Random when omitted — only tests pin it. */
	salt?: Buffer;
	/** Ephemeral sender private key. Generated when omitted. */
	senderPrivateKey?: Buffer;
}

/**
 * Encrypt a payload into an `aes128gcm` body, ready to POST to the endpoint.
 *
 * One record, so the plaintext gets the 0x02 delimiter (last record) and the
 * declared record size is the standard 4096.
 */
export function encryptPayload(
	payload: string | Buffer,
	keys: PushKeys,
	options: EncryptOptions = {}
): Buffer {
	const uaPublic = fromB64url(keys.p256dh);
	const authSecret = fromB64url(keys.auth);
	if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
		throw new Error('p256dh is not an uncompressed P-256 point');
	}
	if (authSecret.length !== 16) throw new Error('auth secret must be 16 octets');

	const ecdh = createECDH('prime256v1');
	if (options.senderPrivateKey) ecdh.setPrivateKey(options.senderPrivateKey);
	else ecdh.generateKeys();
	const asPublic = ecdh.getPublicKey();
	// Throws on a point that is not on the curve, which is exactly the
	// validation RFC 8291 §7 demands before using someone else's key.
	const sharedSecret = ecdh.computeSecret(uaPublic);

	const salt = options.salt ?? randomBytes(16);
	if (salt.length !== 16) throw new Error('salt must be 16 octets');

	// RFC 8291 §3.4: the auth secret keys the combination of the two public
	// keys into the input keying material.
	const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
	const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);
	const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
	const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

	const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
	const cipher = createCipheriv('aes-128-gcm', cek, nonce);
	const ciphertext = Buffer.concat([
		cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
		cipher.final(),
		cipher.getAuthTag()
	]);

	// RFC 8188 §2.1 header: salt | rs (uint32) | idlen (uint8) | keyid.
	const preamble = Buffer.alloc(5);
	preamble.writeUInt32BE(4096, 0);
	preamble.writeUInt8(asPublic.length, 4);
	return Buffer.concat([salt, preamble, asPublic, ciphertext]);
}

/**
 * Build the `Authorization: vapid …` header for one endpoint (RFC 8292).
 *
 * The signature must be the 64-octet JOSE form, not the DER sequence
 * `crypto.sign` returns by default — hence `dsaEncoding: 'ieee-p1363'`, which
 * is the whole of that famous footgun.
 *
 * The private key is a raw 32-octet scalar (what `web-push --gen-vapid-keys`
 * and every VAPID generator emit), so it is imported as a JWK alongside the
 * public point rather than wrapped in DER by hand.
 */
export function vapidAuthorization(input: {
	endpoint: string;
	subject: string;
	publicKey: string;
	privateKey: string;
	/** Seconds of validity. Capped at 24 h by RFC 8292. */
	expiresInS?: number;
	/** Epoch seconds, injectable for tests. */
	now?: number;
}): string {
	const audience = new URL(input.endpoint).origin;
	const now = Math.floor(input.now ?? Date.now() / 1000);
	const exp = now + Math.min(input.expiresInS ?? 12 * 3600, 24 * 3600);

	const publicKey = fromB64url(input.publicKey);
	if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
		throw new Error('VAPID_PUBLIC_KEY is not an uncompressed P-256 point');
	}
	const privateKey = fromB64url(input.privateKey);
	if (privateKey.length !== 32) throw new Error('VAPID_PRIVATE_KEY must be a 32-octet scalar');

	const key = createPrivateKey({
		key: {
			kty: 'EC',
			crv: 'P-256',
			d: b64url(privateKey),
			x: b64url(publicKey.subarray(1, 33)),
			y: b64url(publicKey.subarray(33, 65))
		},
		format: 'jwk'
	});

	const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' }), 'utf8'));
	const body = b64url(
		Buffer.from(JSON.stringify({ aud: audience, exp, sub: input.subject }), 'utf8')
	);
	const signingInput = Buffer.from(`${header}.${body}`, 'utf8');
	const signature = sign('sha256', signingInput, { key, dsaEncoding: 'ieee-p1363' });

	return `vapid t=${header}.${body}.${b64url(signature)}, k=${input.publicKey}`;
}
