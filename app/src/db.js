// Acesso ao MySQL com um pool de conexões (mysql2/promise).
const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 5,
  connectTimeout: 3000,
});

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Cria a tabela e alguns produtos de exemplo na primeira vez.
// Tenta várias vezes porque o banco pode ainda estar subindo: é a própria
// aplicação sendo tolerante, o que complementa o depends_on (Compose) e as
// probes / initContainer (Kubernetes).
async function iniciarBanco(tentativas = 30) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS produtos (
          id INT AUTO_INCREMENT PRIMARY KEY,
          nome VARCHAR(100) NOT NULL,
          preco DECIMAL(10,2) NOT NULL,
          criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM produtos');
      if (total === 0) {
        await pool.query(
          'INSERT INTO produtos (nome, preco) VALUES (?, ?), (?, ?), (?, ?)',
          ['Teclado', 149.9, 'Mouse', 79.9, 'Monitor', 899.0],
        );
      }
      console.log(`[db] banco pronto (tentativa ${i})`);
      return;
    } catch (erro) {
      console.log(`[db] banco indisponível (tentativa ${i}/${tentativas}): ${erro.code || erro.message}`);
      await esperar(2000);
    }
  }
  throw new Error('Não foi possível conectar ao MySQL');
}

async function listarProdutos() {
  const [linhas] = await pool.query('SELECT id, nome, preco, criado_em FROM produtos ORDER BY id');
  return linhas;
}

async function buscarProduto(id) {
  const [linhas] = await pool.query('SELECT id, nome, preco, criado_em FROM produtos WHERE id = ?', [id]);
  return linhas[0] || null;
}

async function criarProduto(nome, preco) {
  const [resultado] = await pool.query('INSERT INTO produtos (nome, preco) VALUES (?, ?)', [nome, preco]);
  return buscarProduto(resultado.insertId);
}

async function removerProduto(id) {
  const [resultado] = await pool.query('DELETE FROM produtos WHERE id = ?', [id]);
  return resultado.affectedRows > 0;
}

// Usado pela rota /ready: um SELECT 1 simples prova que o banco responde.
async function pingBanco() {
  await pool.query('SELECT 1');
}

module.exports = {
  pool, iniciarBanco, listarProdutos, buscarProduto, criarProduto, removerProduto, pingBanco,
};
