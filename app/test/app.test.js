// Testes rápidos que não precisam de MySQL nem Redis: rodam com `npm test`.
const test = require('node:test');
const assert = require('node:assert');
const { app, validarProduto } = require('../src/app');

test('validarProduto aceita produto válido', () => {
  const r = validarProduto({ nome: ' Cadeira ', preco: '350.5' });
  assert.deepStrictEqual(r, { nome: 'Cadeira', preco: 350.5, erros: [] });
});

test('validarProduto recusa nome vazio e preço negativo', () => {
  const r = validarProduto({ nome: '', preco: -1 });
  assert.strictEqual(r.erros.length, 2);
});

test('POST /produtos com JSON quebrado devolve 400', async () => {
  const servidor = app.listen(0);
  try {
    const { port } = servidor.address();
    const resposta = await fetch(`http://127.0.0.1:${port}/produtos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"nome":',
    });
    assert.strictEqual(resposta.status, 400);
  } finally {
    servidor.close();
  }
});

test('GET /health responde 200 sem depender do banco', async () => {
  const servidor = app.listen(0);
  try {
    const { port } = servidor.address();
    const resposta = await fetch(`http://127.0.0.1:${port}/health`);
    assert.strictEqual(resposta.status, 200);
    const corpo = await resposta.json();
    assert.strictEqual(corpo.status, 'ok');
    assert.ok(resposta.headers.get('x-app-version'));
  } finally {
    servidor.close();
  }
});
