import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, verify } from 'node:crypto';
import { encryptPayload, vapidAuthorization } from '../src/lib/server/push-crypto.ts';

/**
 * RFC 8291 §5 "Push Message Encryption Example", with the intermediate values
 * from its Appendix A. Every input is pinned, so the output is deterministic
 * and any drift in the key schedule shows up here rather than as a silently
 * undeliverable notification.
 */
const RFC = {
	plaintext: 'When I grow up, I want to be a watermelon',
	uaPublic:
		'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
	authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
	asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
	asPublic:
		'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
	salt: 'DGv6ra1nlYgDCS1FRnbzlw',
	/** Appendix A: the 86-octet header on its own. */
	header:
		'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
	/** Appendix A: the AES-GCM output on its own. */
	ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
	/** §5: the two concatenated. Not the concatenation of the two base64url
	 *  strings — the header is 86 octets, so the encodings overlap. */
	body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
};

const b64 = (buf: Buffer) => buf.toString('base64url');

test('encryptPayload reproduces the RFC 8291 §5 test vector', () => {
	const body = encryptPayload(
		RFC.plaintext,
		{ p256dh: RFC.uaPublic, auth: RFC.authSecret },
		{
			salt: Buffer.from(RFC.salt, 'base64url'),
			senderPrivateKey: Buffer.from(RFC.asPrivate, 'base64url')
		}
	);
	assert.equal(b64(body), RFC.body);
	assert.equal(b64(body.subarray(0, 86)), RFC.header);
	assert.equal(b64(body.subarray(86)), RFC.ciphertext);
	// 16 salt + 4 rs + 1 idlen + 65 keyid, then 41 plaintext + 1 delimiter + 16 tag.
	assert.equal(body.length, 86 + 58);
});

test('encryptPayload keeps the header shape with a random salt and key', () => {
	const body = encryptPayload('bonjour', { p256dh: RFC.uaPublic, auth: RFC.authSecret });
	assert.equal(body.readUInt32BE(16), 4096);
	assert.equal(body.readUInt8(20), 65);
	assert.equal(body.readUInt8(21), 0x04); // uncompressed sender point
	assert.equal(body.length, 86 + Buffer.byteLength('bonjour') + 1 + 16);

	const other = encryptPayload('bonjour', { p256dh: RFC.uaPublic, auth: RFC.authSecret });
	assert.notEqual(b64(body), b64(other), 'salt and ephemeral key must not repeat');
});

test('encryptPayload refuses malformed subscription keys', () => {
	assert.throws(
		() => encryptPayload('x', { p256dh: 'AAAA', auth: RFC.authSecret }),
		/uncompressed P-256/
	);
	assert.throws(
		() => encryptPayload('x', { p256dh: RFC.uaPublic, auth: 'c2hvcnQ' }),
		/16 octets/
	);
});

test('vapidAuthorization signs a verifiable ES256 JWT in JOSE form', () => {
	const ecdh = createECDH('prime256v1');
	ecdh.generateKeys();
	const publicKey = b64(ecdh.getPublicKey());
	const privateKey = b64(ecdh.getPrivateKey());

	const header = vapidAuthorization({
		endpoint: 'https://web.push.apple.com/abc/def?x=1',
		subject: 'mailto:pi@example.invalid',
		publicKey,
		privateKey,
		now: 1_700_000_000
	});

	const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
	assert.ok(match, `unexpected header: ${header}`);
	assert.equal(match[2], publicKey);

	const [encodedHeader, encodedBody, encodedSignature] = match[1].split('.');
	assert.deepEqual(JSON.parse(Buffer.from(encodedHeader, 'base64url').toString()), {
		typ: 'JWT',
		alg: 'ES256'
	});
	const claims = JSON.parse(Buffer.from(encodedBody, 'base64url').toString());
	// The audience is the endpoint ORIGIN — path and query must be dropped.
	assert.equal(claims.aud, 'https://web.push.apple.com');
	assert.equal(claims.sub, 'mailto:pi@example.invalid');
	assert.equal(claims.exp, 1_700_000_000 + 12 * 3600);

	const signature = Buffer.from(encodedSignature, 'base64url');
	assert.equal(signature.length, 64, 'ES256 signatures are r||s, not DER');

	const point = Buffer.from(publicKey, 'base64url');
	const verifier = createPublicKey({
		key: {
			kty: 'EC',
			crv: 'P-256',
			x: b64(point.subarray(1, 33)),
			y: b64(point.subarray(33, 65))
		},
		format: 'jwk'
	});
	assert.equal(
		verify(
			'sha256',
			Buffer.from(`${encodedHeader}.${encodedBody}`, 'utf8'),
			{ key: verifier, dsaEncoding: 'ieee-p1363' },
			signature
		),
		true
	);
});

test('vapidAuthorization caps the token lifetime at 24 h', () => {
	const ecdh = createECDH('prime256v1');
	ecdh.generateKeys();
	const header = vapidAuthorization({
		endpoint: 'https://fcm.googleapis.com/fcm/send/xyz',
		subject: 'mailto:pi@example.invalid',
		publicKey: b64(ecdh.getPublicKey()),
		privateKey: b64(ecdh.getPrivateKey()),
		expiresInS: 90 * 3600,
		now: 1000
	});
	const claims = JSON.parse(
		Buffer.from(header.split('t=')[1].split('.')[1], 'base64url').toString()
	);
	assert.equal(claims.exp, 1000 + 24 * 3600);
});
