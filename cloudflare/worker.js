// Private R2 gateway. No service-account credentials or public buckets.
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const fields = new Set(['foto', 'fotoConclusao']);
const units = new Set(['101','102','103','104','105','106','107','108','110','111','112','113','115','117']);
function gateways(env) {
    const routes = JSON.parse(env.UNIT_GATEWAYS || '{}');
    for (const [unit, endpoint] of Object.entries(routes)) {
        const url = new URL(endpoint);
        if (!units.has(unit) || url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new HttpError(503, 'Configuração de armazenamento inválida.');
    }
    return routes;
}
class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
function json(value, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
export function createHandler(fetchImpl = fetch) {
    async function firebaseRead(env, path, token) {
        const url = new URL(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, '')}/${path}.json`);
        url.searchParams.set('auth', token);
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
        if (response.status === 401 || response.status === 403) throw new HttpError(403, 'Acesso recusado pelo Firebase.');
        if (!response.ok) throw new HttpError(503, 'Firebase indisponível. Tente novamente.');
        return response.json();
    }
    async function authorize(request, env) {
        const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1];
        if (!token) throw new HttpError(401, 'Entre com sua conta do sistema.');
        // Firebase validates the token (signature, expiry and account). Never trust a decoded JWT.
        const response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new HttpError(response.status >= 500 ? 503 : 401, 'Sessão inválida. Entre novamente.');
        const account = (await response.json()).users?.[0];
        if (!account?.localId || account.disabled) throw new HttpError(401, 'Conta indisponível.');
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(account.localId)) throw new HttpError(401, 'Conta inválida.');
        const profile = await firebaseRead(env, `users/${account.localId}`, token);
        if (profile?.status !== 'approved') throw new HttpError(403, 'Sua conta precisa estar aprovada.');
        return { token, uid: account.localId, admin: profile.role === 'admin', unitId: profile.unitId || '' };
    }
    return async function handle(request, env) {
        const origin = request.headers.get('Origin');
        const allowed = env.ALLOWED_ORIGIN;
        let response;
        try {
            if (origin !== allowed) throw new HttpError(403, 'Origem não autorizada.');
            if (request.method === 'OPTIONS') {
                response = new Response(null, { status: 204 });
            } else {
                const url = new URL(request.url);
                const match = url.pathname.match(/^\/photos\/(\d{1,20})\/(foto|fotoConclusao)$/);
                if (!match || !fields.has(match[2])) throw new HttpError(404, 'Rota não encontrada.');
                if (!['GET', 'POST', 'DELETE'].includes(request.method)) throw new HttpError(405, 'Método não permitido.');
                const [, id, field] = match;
                const actor = await authorize(request, env);
                // Routes are controlled only by Worker configuration, never client URLs.
                const routes = gateways(env);
                const dedicated = env.PHOTO_UNIT_ID || '';
                if (dedicated && !units.has(dedicated)) throw new HttpError(503, 'Unidade do armazenamento inválida.');
                const requestedUnit = url.searchParams.get('unit') || actor.unitId;
                const storageUnit = url.searchParams.get('storage') || 'shared';
                if (request.method === 'POST') {
                    if (requestedUnit && !units.has(requestedUnit)) throw new HttpError(400, 'Unidade inválida.');
                    if (!actor.admin && requestedUnit !== actor.unitId) throw new HttpError(403, 'A foto precisa pertencer à sua unidade.');
                    if ((dedicated || Object.keys(routes).length) && !requestedUnit) throw new HttpError(400, 'Informe a unidade da foto.');
                    if (dedicated && requestedUnit !== dedicated) throw new HttpError(403, 'Este serviço atende outra unidade.');
                } else {
                    if (storageUnit !== 'shared' && !units.has(storageUnit)) throw new HttpError(400, 'Destino de foto inválido.');
                    if (dedicated && storageUnit !== dedicated) throw new HttpError(400, 'Destino de foto incorreto.');
                }
                const destination = request.method === 'POST' ? requestedUnit : storageUnit;
                const endpoint = !dedicated && destination !== 'shared' ? routes[destination] : null;
                // A stored remote destination must not fall back to a different bucket.
                if (request.method !== 'POST' && storageUnit !== 'shared' && !dedicated && !endpoint) throw new HttpError(503, 'O armazenamento desta foto está indisponível.');
                if (endpoint) {
                    if (new URL(endpoint).origin === url.origin) throw new HttpError(503, 'Rota circular de armazenamento.');
                    if (request.method !== 'POST') {
                        const published = await firebaseRead(env, `fotos/${id}/${field}`, actor.token);
                        if (request.method === 'GET' && (published?.storageUnit !== storageUnit || published?.key !== url.searchParams.get('key'))) throw new HttpError(404, 'Foto não encontrada.');
                        if (request.method === 'DELETE' && (!actor.admin || published?.key === url.searchParams.get('key'))) throw new HttpError(actor.admin ? 409 : 403, 'Exclusão não autorizada.');
                    }
                    const target = new URL(url.pathname + url.search, endpoint);
                    response = await fetchImpl(target, {
                        method: request.method,
                        headers: { Origin: allowed, Authorization: `Bearer ${actor.token}`, 'Content-Type': request.headers.get('Content-Type') || '' },
                        body: request.method === 'POST' ? request.body : undefined,
                        redirect: 'manual', signal: AbortSignal.timeout(60000), duplex: 'half'
                    });
                    if (response.status >= 300 && response.status < 400) throw new HttpError(503, 'Redirecionamento do armazenamento recusado.');
                    if (request.method === 'POST' && response.ok) {
                        const uploaded = await response.json();
                        if (uploaded.storage !== 'r2' || uploaded.storageUnit !== destination || uploaded.unitId !== destination || !new RegExp(`^units/${destination}/photos/${id}/${field}/[a-f0-9-]{36}\\.jpg$`).test(uploaded.key || '')) throw new HttpError(503, 'O serviço de destino não confirmou a unidade correta.');
                        response = json(uploaded, 201);
                    }
                } else if (request.method === 'POST') {
                    if (request.headers.get('Content-Type') !== 'image/jpeg') throw new HttpError(415, 'Envie uma foto JPEG.');
                    if (Number(request.headers.get('Content-Length')) > MAX_PHOTO_BYTES) throw new HttpError(413, 'Foto muito grande.');
                    // Bounded streaming prevents an unbounded arrayBuffer allocation.
                    const reader = request.body?.getReader();
                    if (!reader) throw new HttpError(400, 'Foto vazia.');
                    const chunks = []; let size = 0;
                    while (true) {
                        const part = await reader.read();
                        if (part.done) break;
                        size += part.value.length;
                        if (size > MAX_PHOTO_BYTES) { await reader.cancel(); throw new HttpError(413, 'Foto muito grande.'); }
                        chunks.push(part.value);
                    }
                    const bytes = new Uint8Array(size); let offset = 0;
                    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
                    if (size < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[size - 2] !== 255 || bytes[size - 1] !== 217) throw new HttpError(415, 'JPEG inválido.');
                    // Uploads are immutable. The existing Firebase write rules authorize publication.
                    const prefix = requestedUnit ? `units/${requestedUnit}/` : '';
                    const key = `${prefix}photos/${id}/${field}/${crypto.randomUUID()}.jpg`;
                    await env.PHOTOS.put(key, bytes, {
                        httpMetadata: { contentType: 'image/jpeg' },
                        customMetadata: { uid: actor.uid, id, field, unitId: requestedUnit || '' }
                    });
                    response = json({ storage: 'r2', key, bytes: size, contentType: 'image/jpeg', ...(requestedUnit ? { unitId: requestedUnit, storageUnit: dedicated || 'shared' } : {}) }, 201);
                } else {
                    const key = url.searchParams.get('key');
                    if (!key || !new RegExp(`^(?:units/(101|102|103|104|105|106|107|108|110|111|112|113|115|117)/)?photos/${id}/${field}/[a-f0-9-]{36}\\.jpg$`).test(key)) throw new HttpError(400, 'Referência de foto inválida.');
                    if (dedicated && !key.startsWith(`units/${dedicated}/`)) throw new HttpError(400, 'Chave de outra unidade.');
                    const value = await firebaseRead(env, `fotos/${id}/${field}`, actor.token);
                    if (request.method === 'GET') {
                        if (value?.storage !== 'r2' || value.key !== key || (value.storageUnit || 'shared') !== (dedicated || 'shared')) throw new HttpError(404, 'Foto não encontrada.');
                        const object = await env.PHOTOS.get(key);
                        if (!object) throw new HttpError(404, 'Foto não encontrada.');
                        response = new Response(object.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } });
                    } else {
                        if (!actor.admin) throw new HttpError(403, 'Apenas o administrador pode excluir fotos.');
                        if (value?.key === key) throw new HttpError(409, 'A foto ainda está vinculada ao registro.');
                        await env.PHOTOS.delete(key);
                        response = new Response(null, { status: 204 });
                    }
                }
            }
        } catch (error) {
            response = json({ error: error instanceof HttpError ? error.message : 'Serviço de fotos indisponível. Tente novamente.' }, error.status || 503);
        }
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'private, no-store');
        headers.set('Vary', 'Origin');
        headers.set('X-Content-Type-Options', 'nosniff');
        if (origin === allowed) {
            headers.set('Access-Control-Allow-Origin', allowed);
            headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
            headers.set('Access-Control-Max-Age', '3600');
        }
        return new Response(response.body, { status: response.status, headers });
    };
}
export default { fetch: createHandler() };
