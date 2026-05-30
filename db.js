const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS institutions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        institution_id INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT 'Other',
        price NUMERIC(10,2) NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        min_stock INTEGER NOT NULL DEFAULT 5,
        emoji VARCHAR(10) DEFAULT '🍽️',
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS student_cards (
        id SERIAL PRIMARY KEY,
        institution_id INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
        student_id VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        class VARCHAR(100),
        rfid VARCHAR(100),
        balance NUMERIC(10,2) NOT NULL DEFAULT 0,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(institution_id, student_id)
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        institution_id INTEGER REFERENCES institutions(id) ON DELETE CASCADE,
        card_id INTEGER REFERENCES student_cards(id),
        student_name VARCHAR(255),
        type VARCHAR(20) NOT NULL CHECK (type IN ('sale','topup')),
        items TEXT,
        amount NUMERIC(10,2) NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transaction_items (
        id SERIAL PRIMARY KEY,
        transaction_id INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        product_name VARCHAR(255),
        quantity INTEGER NOT NULL,
        unit_price NUMERIC(10,2) NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_products_institution ON products(institution_id);
      CREATE INDEX IF NOT EXISTS idx_cards_institution ON student_cards(institution_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_institution ON transactions(institution_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
    `);
    console.log('✅ Database tables ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
