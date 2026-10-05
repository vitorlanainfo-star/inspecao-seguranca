// Private gateway validated against Firebase and the R2 bucket.
export const PHOTO_API_URL = 'https://inspecao-fotos.vitor-lana-info.workers.dev';

export function isR2Photo(value) {
    return value?.storage === 'r2' && typeof value.key === 'string';
}

export function createPhotoStorage({ apiUrl = PHOTO_API_URL, getUser, fetchImpl = fetch }) {
    const base = apiUrl.replace(/\/$/, '');
    if (base && !base.startsWith('https://')) throw new Error('O serviço de fotos precisa usar HTTPS.');
    async function request(path, options = {}) {
        if (!base) throw new Error('O serviço de fotos ainda não foi configurado.');
        const user = getUser();
        if (!user) throw new Error('Entre novamente para acessar as fotos.');
        const token = await user.getIdToken();
        const response = await fetchImpl(`${base}${path}`, {
            ...options, signal: AbortSignal.timeout(60000),
            headers: { ...options.headers, Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Não foi possível acessar o serviço de fotos. Tente novamente.');
        }
        return response;
    }
    return {
        enabled: !!base,
        async upload(id, field, dataUrl) {
            if (!base) return dataUrl;
            if (!/^data:image\/jpeg;base64,/.test(dataUrl)) throw new Error('Formato de foto não suportado.');
            const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
            const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
            const response = await request(`/photos/${encodeURIComponent(id)}/${field}`, {
                method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: bytes
            });
            return response.json();
        },
        async read(id, field, value) {
            if (!isR2Photo(value)) return value;
            const response = await request(`/photos/${encodeURIComponent(id)}/${field}?key=${encodeURIComponent(value.key)}`);
            const buffer = new Uint8Array(await response.arrayBuffer());
            let binary = '';
            for (let i = 0; i < buffer.length; i += 8192) binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
            return `data:image/jpeg;base64,${btoa(binary)}`;
        },
        async remove(id, field, value) {
            if (!isR2Photo(value)) return;
            await request(`/photos/${encodeURIComponent(id)}/${field}?key=${encodeURIComponent(value.key)}`, { method: 'DELETE' });
        }
    };
}
