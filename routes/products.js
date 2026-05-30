const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET all products
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM products WHERE institution_id=$1 AND active=TRUE ORDER BY name',
      [req.session.institutionId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create product
router.post('/', requireAuth, async (req, res) => {
  const { name, category, price, stock, min_stock, emoji } = req.body;
  if (!name || price == null)
    return res.status(400).json({ error: 'Name and price are required' });
  try {
    const result = await pool.query(
      `INSERT INTO products(institution_id,name,category,price,stock,min_stock,emoji)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.session.institutionId, name, category||'Other', price, stock||0, min_stock||5, emoji||'🍽️']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update product
router.put('/:id', requireAuth, async (req, res) => {
  const { name, category, price, stock, min_stock, emoji } = req.body;
  try {
    const result = await pool.query(
      `UPDATE products SET name=$1,category=$2,price=$3,stock=$4,min_stock=$5,emoji=$6
       WHERE id=$7 AND institution_id=$8 RETURNING *`,
      [name, category, price, stock, min_stock, emoji, req.params.id, req.session.institutionId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST restock — adds to existing stock (fixes the zero-stock bug)
router.post('/:id/restock', requireAuth, async (req, res) => {
  const { quantity, note } = req.body;
  const qty = parseInt(quantity);
  if (!qty || qty <= 0)
    return res.status(400).json({ error: 'Quantity must be a positive number' });
  try {
    const result = await pool.query(
      `UPDATE products SET stock = stock + $1
       WHERE id=$2 AND institution_id=$3 RETURNING *`,
      [qty, req.params.id, req.session.institutionId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json({ product: result.rows[0], added: qty, note: note || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE (soft delete) product
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE products SET active=FALSE WHERE id=$1 AND institution_id=$2',
      [req.params.id, req.session.institutionId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
