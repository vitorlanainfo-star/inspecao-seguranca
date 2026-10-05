import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoStorage, isR2Photo } from '../photo-storage.js';
import { createHandler } from '../cloudflare/worker.js';

const jpeg = new Uint8Array([255, 216, 1, 2, 255, 217]);
const dataUrl = `data:image/jpeg;base64,${btoa(String.fromCharCode(...jpeg))}`;
const origin = 'https://vitorlanainfo-star.github.io';
const key = 'photos/123/foto/00000000-0000-4000-8000-000000000000.jpg';
const descriptor = { storage: 'r2', key };
function fixture({ profile = { status: 'approved', role: 'user' }, reference = descriptor, disabled = false, lookupStatus = 200 } = {}) {
    const objects = new Map([[key, jpeg]]);
    const calls = [];
    const env = {
        ALLOWED_ORIGIN: origin, FIREBASE_DATABASE_URL: 'https://project.firebaseio.com', FIREBASE_API_KEY: 'public-key',
        PHOTOS: {
            async put(k, bytes, options) { calls.push(['put', k, options]); objects.set(k, bytes); },
            async get(k) { calls.push(['get', k]); return objects.has(k) ? { body: objects.get(k) } : null; },
            async delete(k) { calls.push(['delete', k]); objects.delete(k); }
        }
    };
    const fetchImpl = async (url, options) => {
        const str = String(url);
        calls.push(['fetch', str]);
        if (str.startsWith('https://identitytoolkit.googleapis.com/')) {
            assert.equal(JSON.parse(options.body).idToken, 'valid-token');
            return new Response(JSON.stringify({ users: [{ localId: 'user-1', disabled }] }), { status: lookupStatus });
        }
        assert.equal(new URL(str).searchParams.get('auth'), 'valid-token');
        if (str.includes('/users/user-1.json')) return Response.json(profile);
        if (str.includes('/fotos/123/foto.json')) return Response.json(reference);
        throw new Error('Unexpected endpoint');
    };
    const handler = createHandler(fetchImpl);
    const send = (method = 'GET', { token = 'valid-token', reqOrigin = origin, path = `/photos/123/foto?key=${encodeURIComponent(key)}`, body, type = 'image/jpeg' } = {}) => handler(new Request(`https://photos.example${path}`, {
        method, headers: { Origin: reqOrigin, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': type }, body
    }), env);
    return { send, objects, calls };
}
test('disabled configuration preserves legacy photos without any network request', async () => {
    const store = createPhotoStorage({ apiUrl: '', getUser: () => null, fetchImpl: () => assert.fail('network') });
    assert.equal(store.enabled, false);
    assert.equal(await store.upload(123, 'foto', dataUrl), dataUrl);
    assert.equal(await store.read(123, 'foto', dataUrl), dataUrl);
});
test('R2 upload and read use the Firebase token and preserve cached data URL representation', async () => {
    const calls = [];
    const store = createPhotoStorage({ apiUrl: 'https://photos.example/', getUser: () => ({ getIdToken: async () => 'token' }), fetchImpl: async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer token'); calls.push(url);
        if (options.method === 'POST') { assert.deepEqual(options.body, jpeg); return Response.json(descriptor); }
        return new Response(jpeg);
    } });
    assert.deepEqual(await store.upload(123, 'foto', dataUrl), descriptor);
    assert.equal(await store.read(123, 'foto', descriptor), dataUrl);
    assert.equal(calls.length, 2);
    assert.equal(isR2Photo(dataUrl), false);
});
test('client upload errors reject instead of silently falling back to expensive database bytes', async () => {
    const store = createPhotoStorage({ apiUrl: 'https://photos.example', getUser: () => ({ getIdToken: async () => 'token' }), fetchImpl: async () => Response.json({ error: 'Quota exceeded' }, { status: 503 }) });
    await assert.rejects(store.upload(123, 'foto', dataUrl), /Quota exceeded/);
});
test('unconfigured gateway refuses R2 reads instead of misrepresenting descriptor as image', async () => {
    const store = createPhotoStorage({ apiUrl: '', getUser: () => null });
    await assert.rejects(store.read(123, 'foto', descriptor), /configurado/);
});
test('private photo read checks current approved profile and exact published reference', async () => {
    const f = fixture(); const response = await f.send();
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpeg);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
test('unknown origin denied before token validation or storage use', async () => {
    const f = fixture(); assert.equal((await f.send('GET', { reqOrigin: 'https://evil.example' })).status, 403);
    assert.equal(f.calls.length, 0);
});
test('CORS preflight requires no login and performs no backend reads', async () => {
    const f = fixture(); assert.equal((await f.send('OPTIONS', { token: null })).status, 204); assert.equal(f.calls.length, 0);
});
test('missing token, rejected token and disabled accounts cannot read photos', async () => {
    assert.equal((await fixture().send('GET', { token: null })).status, 401);
    assert.equal((await fixture({ lookupStatus: 400 }).send()).status, 401);
    assert.equal((await fixture({ disabled: true }).send()).status, 401);
});
test('pending and revoked approval deny read and upload', async () => {
    for (const status of ['pending', 'blocked']) {
        const f = fixture({ profile: { status, role: 'user' } });
        assert.equal((await f.send()).status, 403);
        assert.equal((await f.send('POST', { body: jpeg })).status, 403);
        assert.ok(!f.calls.some(x => x[0] === 'get' || x[0] === 'put'));
    }
});
test('knowing an old or another record key does not grant access', async () => {
    const f = fixture({ reference: { storage: 'r2', key: `${key}-other` } });
    assert.equal((await f.send()).status, 404);
    assert.ok(!f.calls.some(x=>x[0] === 'get'));
    assert.equal((await fixture().send('GET', { path: '/photos/123/foto?key=photos/456/foto/x.jpg' })).status, 400);
});
test('approved uploads create immutable objects with owner metadata', async () => {
    const f = fixture(); const response = await f.send('POST', { body: jpeg });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.match(result.key, /^photos\/123\/foto\/[a-f0-9-]+\.jpg$/);
    assert.equal(result.bytes, jpeg.length);
    assert.deepEqual(f.objects.get(result.key), jpeg);
    assert.notEqual(result.key, key);
    assert.equal(f.calls.find(x=>x[0]==='put')[2].customMetadata.uid, 'user-1');
});
test('invalid JPEG, wrong MIME and oversized upload rejected without storage writes', async () => {
    const f = fixture();
    assert.equal((await f.send('POST', { body: 'not an image' })).status, 415);
    assert.equal((await f.send('POST', { body: jpeg, type: 'text/html' })).status, 415);
    assert.equal((await f.send('POST', { body: new Uint8Array(8 * 1024 * 1024 + 1) })).status, 413);
    assert.ok(!f.calls.some(x=>x[0] === 'put'));
});
test('deletion requires administrator and cannot delete a published photo', async () => {
    assert.equal((await fixture().send('DELETE')).status, 403);
    assert.equal((await fixture({ profile: { status: 'approved', role: 'admin' } }).send('DELETE')).status, 409);
    const f = fixture({ profile: { status: 'approved', role: 'admin' }, reference: null });
    assert.equal((await f.send('DELETE')).status, 204);
    assert.equal(f.objects.has(key), false);
});
test('wrong routes and methods are rejected', async () => {
    assert.equal((await fixture().send('GET', { path: '/photos/123/password' })).status, 404);
    assert.equal((await fixture().send('PUT')).status, 405);
});
