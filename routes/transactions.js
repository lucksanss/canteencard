const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET transactions (most recent first, limit 200)
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, sc.student_id
       FROM transactions t
       LEFT JOIN student_cards sc ON sc.id=t.card_id
       WHERE t.institution_id=$1
       ORDER BY t.created_at DESC LIMIT 200`,
      [req.session.institutionId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET dashboard stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const [sales, topups, lowStock, outStock] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as count
         FROM transactions WHERE institution_id=$1 AND type='sale' AND created_at>=$2`,
        [req.session.institutionId, today]
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount),0) as total FROM transactions
         WHERE institution_id=$1 AND type='topup' AND created_at>=$2`,
        [req.session.institutionId, today]
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM products
         WHERE institution_id=$1 AND active=TRUE AND stock < min_stock AND stock > 0`,
        [req.session.institutionId]
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM products
         WHERE institution_id=$1 AND active=TRUE AND stock = 0`,
        [req.session.institutionId]
      )
    ]);
    res.json({
      todaySales: parseFloat(sales.rows[0].total),
      todaySaleCount: parseInt(sales.rows[0].count),
      todayTopups: parseFloat(topups.rows[0].total),
      lowStockCount: parseInt(lowStock.rows[0].count),
      outOfStockCount: parseInt(outStock.rows[0].count)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST complete a sale — atomic: deduct stock + balance + record transaction
router.post('/sell', requireAuth, async (req, res) => {
  const { card_id, items } = req.body;
  // items: [{ product_id, quantity }]
  if (!card_id || !items || !items.length)
    return res.status(400).json({ error: 'Card and items are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock and fetch card
    const cardRes = await client.query(
      'SELECT * FROM student_cards WHERE id=$1 AND institution_id=$2 AND active=TRUE FOR UPDATE',
      [card_id, req.session.institutionId]
    );
    if (!cardRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Card not found' });
    }
    const card = cardRes.rows[0];

    // Fetch and lock all products
    const productIds = items.map(i => i.product_id);
    const productsRes = await client.query(
      `SELECT * FROM products WHERE id=ANY($1) AND institution_id=$2 AND active=TRUE FOR UPDATE`,
      [productIds, req.session.institutionId]
    );
    const productMap = {};
    productsRes.rows.forEach(p => { productMap[p.id] = p; });

    // Validate stock for each item
    let total = 0;
    const itemDetails = [];
    for (const item of items) {
      const product = productMap[item.product_id];
      if (!product) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Product not found: ${item.product_id}` });
      }
      if (product.stock < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Insufficient stock for ${product.name} (available: ${product.stock})` });
      }
      const subtotal = parseFloat(product.price) * item.quantity;
      total += subtotal;
      itemDetails.push({ product, quantity: item.quantity, subtotal });
    }

    // Check card balance
    if (parseFloat(card.balance) < total) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Insufficient balance. Required: ₹${total.toFixed(2)}, Available: ₹${card.balance}` });
    }

    // Deduct stock for each product
    for (const detail of itemDetails) {
      await client.query(
        'UPDATE products SET stock=stock-$1 WHERE id=$2',
        [detail.quantity, detail.product.id]
      );
    }

    // Deduct card balance
    const updatedCard = await client.query(
      'UPDATE student_cards SET balance=balance-$1 WHERE id=$2 RETURNING *',
      [total, card_id]
    );

    // Record transaction
    const itemSummary = itemDetails.map(d => `${d.product.name} x${d.quantity}`).join(', ');
    const txnRes = await client.query(
      `INSERT INTO transactions(institution_id,card_id,student_name,type,items,amount)
       VALUES($1,$2,$3,'sale',$4,$5) RETURNING *`,
      [req.session.institutionId, card_id, card.name, itemSummary, total]
    );
    const txn = txnRes.rows[0];

    // Record transaction line items
    for (const detail of itemDetails) {
      await client.query(
        `INSERT INTO transaction_items(transaction_id,product_id,product_name,quantity,unit_price)
         VALUES($1,$2,$3,$4,$5)`,
        [txn.id, detail.product.id, detail.product.name, detail.quantity, detail.product.price]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      transaction: txn,
      card: updatedCard.rows[0],
      total
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
