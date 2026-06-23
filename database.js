import crypto from 'crypto';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
const isDevelopmentMode = process.env.MODE_NODE === 'dev';
const isExampleDatabaseUrl = /host-do-neon|usuario:senha/i.test(databaseUrl || '');
const usePostgres = !isDevelopmentMode && Boolean(databaseUrl) && !isExampleDatabaseUrl;

if (!isDevelopmentMode && (!databaseUrl || isExampleDatabaseUrl)) {
  throw new Error('npm start exige uma DATABASE_URL real do Neon. Para usar SQLite local, execute npm run dev.');
}

if (isDevelopmentMode) {
  console.log('Modo de desenvolvimento: SQLite local selecionado.');
}
const pool = usePostgres
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    })
  : null;
let sqlite = null;

pool?.on('error', (error) => {
  console.error('Erro inesperado em uma conexao ociosa do Neon:', error.message);
});

export async function initializeDatabase() {
  if (usePostgres) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    return 'Neon/PostgreSQL';
  }

  const { DatabaseSync } = await import('node:sqlite');
  sqlite = new DatabaseSync('database.sqlite');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return 'SQLite local';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, salt, storedKey] = String(storedHash || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !storedKey) return false;

  const calculatedKey = crypto.scryptSync(password, salt, 64);
  const expectedKey = Buffer.from(storedKey, 'hex');
  return calculatedKey.length === expectedKey.length && crypto.timingSafeEqual(calculatedKey, expectedKey);
}

export async function createUser({ name, email, password }) {
  const normalizedEmail = email.toLowerCase();
  const passwordHash = hashPassword(password);

  if (usePostgres) {
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [name, normalizedEmail, passwordHash]
    );
    return result.rows[0];
  }

  const result = sqlite
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, normalizedEmail, passwordHash);
  return findUserById(result.lastInsertRowid);
}

export async function authenticateUser(email, password) {
  const normalizedEmail = email.toLowerCase();
  const user = usePostgres
    ? (
        await pool.query(
          'SELECT id, name, email, password_hash FROM users WHERE email = $1 LIMIT 1',
          [normalizedEmail]
        )
      ).rows[0]
    : sqlite
        .prepare('SELECT id, name, email, password_hash FROM users WHERE email = ? LIMIT 1')
        .get(normalizedEmail);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, name: user.name, email: user.email };
}

export async function findUserById(id) {
  if (usePostgres) {
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1 LIMIT 1',
      [id]
    );
    return result.rows[0] || null;
  }

  return sqlite
    .prepare('SELECT id, name, email, created_at FROM users WHERE id = ? LIMIT 1')
    .get(id) || null;
}

export async function checkDatabaseConnection() {
  if (usePostgres) {
    await pool.query('SELECT 1');
    return 'Neon/PostgreSQL';
  }

  sqlite.prepare('SELECT 1').get();
  return 'SQLite local';
}

export default pool;
