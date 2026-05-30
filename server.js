require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { pool, initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session store in PostgreSQL (persists across Render restarts)
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'canteen-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/cards', require('./routes/cards'));
app.use('/api/transactions', require('./routes/transactions'));

// All other routes → serve the SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🍽️  Canteen Card server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
