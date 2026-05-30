const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// GET all cards
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM student_cards WHERE institution_id=$1 AND active=TRUE ORDER BY name',
      [req.session.institutionId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST create card
router.post('/', requireAuth, async (req, res) => {
  const { student_id, name, class: cls, rfid, balance } = req.body;
  if (!student_id || !name)
    return res.status(400).json({ error: 'Student ID and name are required' });
  try {
    const result = await pool.query(
      `INSERT INTO student_cards(institution_id,student_id,name,class,rfid,balance)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.session.institutionId, student_id, name, cls||'', rfid||'', balance||0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Student ID already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update card
router.put('/:id', requireAuth, async (req, res) => {
  const { student_id, name, class: cls, rfid } = req.body;
  try {
    const result = await pool.query(
      `UPDATE student_cards SET student_id=$1,name=$2,class=$3,rfid=$4
       WHERE id=$5 AND institution_id=$6 RETURNING *`,
      [student_id, name, cls, rfid, req.params.id, req.session.institutionId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Card not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST top-up balance
router.post('/:id/topup', requireAuth, async (req, res) => {
  const { amount, note } = req.body;
  const add = parseFloat(amount);
  if (!add || add <= 0)
    return res.status(400).json({ error: 'Amount must be positive' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cardResult = await client.query(
      'UPDATE student_cards SET balance=balance+$1 WHERE id=$2 AND institution_id=$3 RETURNING *',
      [add, req.params.id, req.session.institutionId]
    );
    if (!cardResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Card not found' });
    }
    const card = cardResult.rows[0];
    await client.query(
      `INSERT INTO transactions(institution_id,card_id,student_name,type,items,amount,note)
       VALUES($1,$2,$3,'topup','Top-up',$4,$5)`,
      [req.session.institutionId, card.id, card.name, add, note||null]
    );
    await client.query('COMMIT');
    res.json({ card, added: add });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// DELETE (soft delete)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE student_cards SET active=FALSE WHERE id=$1 AND institution_id=$2',
      [req.params.id, req.session.institutionId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
