const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const exists = await pool.query('SELECT id FROM institutions WHERE email=$1', [email]);
    if (exists.rows.length)
      return res.status(400).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO institutions(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email',
      [name, email, hash]
    );
    const inst = result.rows[0];
    req.session.institutionId = inst.id;
    req.session.institutionName = inst.name;
    res.json({ success: true, institution: { id: inst.id, name: inst.name, email: inst.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });
  try {
    const result = await pool.query('SELECT * FROM institutions WHERE email=$1', [email]);
    if (!result.rows.length)
      return res.status(401).json({ error: 'Invalid email or password' });
    const inst = result.rows[0];
    const valid = await bcrypt.compare(password, inst.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password' });
    req.session.institutionId = inst.id;
    req.session.institutionName = inst.name;
    res.json({ success: true, institution: { id: inst.id, name: inst.name, email: inst.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

router.get('/me', (req, res) => {
  if (!req.session.institutionId)
    return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: req.session.institutionId, name: req.session.institutionName });
});

module.exports = router;
