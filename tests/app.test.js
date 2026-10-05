import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const originalModule = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
function saveHarness({ failUpload = false, failCommit = false, admin = false, remote = true } = {}) {
    const source = originalModule.slice(originalModule.indexOf('window.fbSalvarOcorrencia ='), originalModule.indexOf('window.fbExcluirOcorrencia ='));
    const calls = [], errors = [];
    const context = {
        window: { firebasePodeGerenciar: admin }, currentUser: { uid: 'user-1' }, currentProfile: { status: 'approved' },
        camposFoto: ['foto','fotoConclusao'], fotosPendentesMigracao: new Map(), ocorrenciasPorId: new Map(), cacheFotos: new Map(),
        Date, Math, Object, String, db: {}, ref: (_, path) => path || 'root',
        photoStorage: { async upload(id, field, photo) {
            calls.push(['upload', field]); if (failUpload) throw new Error('Upload falhou');
            return remote ? { storage: 'r2', key: `photos/${id}/${field}/new.jpg` } : photo;
        } },
        update: async (_, value) => { calls.push(['commit', value]); if (failCommit) throw new Error('Firebase falhou'); },
        guardarFotoPersistida: async () => { calls.push(['cache']); }, registrarAuditoria: async () => { calls.push(['audit']); },
        console: { error() {} }, alert: message => errors.push(message)
    };
    vm.runInNewContext(source, context);
    return { save: context.window.fbSalvarOcorrencia, calls, context, errors };
}
const photo = 'data:image/jpeg;base64,/9j/2Q==';
test('record and both photo descriptors committed atomically after uploads; metadata and caching preserved', async () => {
    const f = saveHarness({ admin: true });
    const item = { id: 123, ticket: 10, status: 'concluido', desc: 'TESTE', foto: photo, fotoConclusao: photo, customField: 'preserved' };
    assert.equal(await f.save(item), true);
    assert.deepEqual(f.calls.slice(0,3).map(x=>x[0]), ['upload','upload','commit']);
    const saved = f.calls.find(x=>x[0]==='commit')[1];
    const record = saved['ocorrencias/123'];
    assert.equal(record.customField, 'preserved'); assert.equal(record.desc, item.desc);
    assert.equal(record.temFoto, true); assert.equal(record.temFotoConclusao, true);
    assert.ok(record.versoesFotoCache.foto); assert.ok(record.versoesFotoCache.fotoConclusao);
    assert.ok(!('foto' in record)); assert.ok(!('fotoConclusao' in record));
    assert.equal(saved['fotos/123/foto'].storage, 'r2');
    assert.equal(f.context.cacheFotos.size, 2);
    assert.equal(item.foto, photo);
});
test('upload failure does not publish incomplete record or populate success cache', async () => {
    const f = saveHarness({ failUpload: true });
    assert.equal(await f.save({ id: 123, foto: photo }), false);
    assert.equal(f.calls.length, 1); assert.equal(f.context.cacheFotos.size, 0);
    assert.match(f.errors[0], /Upload falhou/);
});
test('Firebase rejection does not mark upload as successful', async () => {
    const f = saveHarness({ failCommit: true });
    assert.equal(await f.save({ id: 123, foto: photo }), false);
    assert.equal(f.context.cacheFotos.size, 0); assert.ok(!f.calls.some(x=>x[0]==='audit'));
});
test('records without new images keep existing photo flags and version', async () => {
    const f = saveHarness();
    await f.save({ id: 123, temFoto: true, foto: null, versoesFotoCache: { foto: 'old' } });
    assert.ok(!f.calls.some(x=>x[0]==='upload'));
    const changes = f.calls.find(x=>x[0]==='commit')[1];
    assert.deepEqual(Object.keys(changes), ['ocorrencias/123']);
    assert.equal(changes['ocorrencias/123'].temFoto, true);
    assert.equal(changes['ocorrencias/123'].versoesFotoCache.foto, 'old');
});
test('disabled R2 preserves the existing Base64 save format', async () => {
    const f = saveHarness({ remote: false }); await f.save({ id: 123, foto: photo });
    assert.equal(f.calls.find(x=>x[0]==='commit')[1]['fotos/123/foto'], photo);
});
test('inline scripts remain syntactically valid after integration', () => {
    for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (!match[2].trim()) continue;
        const source = match[2].replace(/^\s*import[^\n]*;\s*$/gm, '');
        new vm.Script(source);
    }
});
test('photo click can call the module zoom handler from HTML', () => {
    const zooms=[];
    const source=originalModule.slice(originalModule.indexOf('function abrirZoomImgDoElemento'),originalModule.indexOf('const observadorFotos'));
    const context={window:{location:{href:'https://app.example/'}},abrirZoomImg:url=>zooms.push(url)};
    vm.runInNewContext(source,context);
    context.window.abrirZoomImgDoElemento({src:'data:image/jpeg;base64,photo'});
    assert.deepEqual(zooms,['data:image/jpeg;base64,photo']);
});
