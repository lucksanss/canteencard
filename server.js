const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;

const session = require('express-session');

// Middleware
app.use(session({
  secret: 'hostel-canteen-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true in production with HTTPS
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Database
const db = new sqlite3.Database('./canteen.db');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS institutions (
    id INTEGER PRIMARY KEY,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY,
    institution_id INTEGER,
    card_number TEXT,
    name TEXT,
    balance REAL DEFAULT 0,
    FOREIGN KEY(institution_id) REFERENCES institutions(id),
    UNIQUE(institution_id, card_number)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    institution_id INTEGER,
    name TEXT,
    price REAL,
    quantity INTEGER DEFAULT 0,
    FOREIGN KEY(institution_id) REFERENCES institutions(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    institution_id INTEGER,
    student_id INTEGER,
    products TEXT,
    total REAL,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(institution_id) REFERENCES institutions(id),
    FOREIGN KEY(student_id) REFERENCES students(id)
  )`);

  // Insert default institution for backward compatibility
  db.run(`INSERT OR IGNORE INTO institutions (name, email, password) VALUES ('Default School', 'admin@school.com', 'admin')`);
});

// Middleware to check authentication
function requireAuth(req, res, next) {
  if (req.session.institutionId) {
    next();
  } else {
    res.redirect('/');
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  db.run('INSERT INTO institutions (name, email, password) VALUES (?, ?, ?)', [name, email, password], function(err) {
    if (err) {
      res.send('Email already exists or registration failed');
    } else {
      res.redirect('/');
    }
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM institutions WHERE email = ? AND password = ?', [email, password], (err, institution) => {
    if (institution) {
      req.session.institutionId = institution.id;
      req.session.institutionName = institution.name;
      res.redirect('/dashboard');
    } else {
      res.send('Invalid credentials');
    }
  });
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', { institutionName: req.session.institutionName });
});

app.get('/add-student', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'add-student.html'));
});

app.post('/add-student', requireAuth, (req, res) => {
  const { card_number, name, balance } = req.body;
  const institutionId = req.session.institutionId;
  db.run('INSERT INTO students (institution_id, card_number, name, balance) VALUES (?, ?, ?, ?)', 
         [institutionId, card_number, name, parseFloat(balance)], (err) => {
    if (err) {
      res.send('Error adding student');
    } else {
      res.redirect('/dashboard');
    }
  });
});

app.get('/add-product', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'add-product.html'));
});

app.post('/add-product', requireAuth, (req, res) => {
  const { name, price, quantity } = req.body;
  const institutionId = req.session.institutionId;
  db.run('INSERT INTO products (institution_id, name, price, quantity) VALUES (?, ?, ?, ?)', 
         [institutionId, name, parseFloat(price), parseInt(quantity)], (err) => {
    if (err) {
      res.send('Error adding product');
    } else {
      res.redirect('/dashboard');
    }
  });
});

app.get('/recharge', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'recharge.html'));
});

app.post('/recharge', requireAuth, (req, res) => {
  const { card_number, amount } = req.body;
  const institutionId = req.session.institutionId;
  db.run('UPDATE students SET balance = balance + ? WHERE card_number = ? AND institution_id = ?', 
         [parseFloat(amount), card_number, institutionId], (err) => {
    if (err) {
      res.send('Error recharging');
    } else {
      res.redirect('/dashboard');
    }
  });
});

app.get('/billing', requireAuth, (req, res) => {
  const institutionId = req.session.institutionId;
  db.all('SELECT * FROM products WHERE institution_id = ?', [institutionId], (err, products) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Database error occurred');
    }
    res.render('billing', { products: products || [] });
  });
});

app.get('/history', requireAuth, (req, res) => {
  const institutionId = req.session.institutionId;
  db.all('SELECT t.*, s.name FROM transactions t JOIN students s ON t.student_id = s.id WHERE t.institution_id = ? ORDER BY t.date DESC', 
         [institutionId], (err, transactions) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).send('Database error occurred');
    }
    res.render('history', { transactions: transactions || [] });
  });
});

app.post('/check-balance', requireAuth, (req, res) => {
  const { card_number } = req.body;
  const institutionId = req.session.institutionId;
  db.get('SELECT balance FROM students WHERE card_number = ? AND institution_id = ?', 
         [card_number, institutionId], (err, student) => {
    res.json({ balance: student ? student.balance : 0 });
  });
});

app.post('/billing', requireAuth, (req, res) => {
  const { card_number, products, total } = req.body;
  const institutionId = req.session.institutionId;

  db.get('SELECT * FROM students WHERE card_number = ? AND institution_id = ?',
         [card_number, institutionId], (err, student) => {
    if (!student || student.balance < total) {
      res.send('Insufficient balance or invalid card');
    } else {
      // Parse products and update quantities
      const productData = JSON.parse(products);
      let updateCount = 0;
      const totalUpdates = Object.keys(productData).length;

      if (totalUpdates === 0) {
        // No products to update, just complete transaction
        completeTransaction();
        return;
      }

      for (const [productName, quantity] of Object.entries(productData)) {
        db.run('UPDATE products SET quantity = quantity - ? WHERE name = ? AND institution_id = ? AND quantity >= ?',
               [quantity, productName, institutionId, quantity], function(err) {
          updateCount++;
          if (err) {
            console.error('Error updating product quantity:', err);
            return res.send('Error updating inventory');
          }

          if (this.changes === 0) {
            return res.send('Insufficient stock for ' + productName);
          }

          if (updateCount === totalUpdates) {
            completeTransaction();
          }
        });
      }

      function completeTransaction() {
        db.run('UPDATE students SET balance = balance - ? WHERE id = ?', [total, student.id]);
        db.run('INSERT INTO transactions (institution_id, student_id, products, total) VALUES (?, ?, ?, ?)',
               [institutionId, student.id, products, total]);
        res.send('Transaction successful');
      }
    }
  });
});

app.get('/export-daily-report', requireAuth, async (req, res) => {
  const institutionId = req.session.institutionId;
  const date = req.query.date || new Date().toISOString().split('T')[0]; // Default to today

  try {
    // Get transactions for the specified date
    const transactions = await new Promise((resolve, reject) => {
      db.all(`
        SELECT t.*, s.name as student_name, s.card_number
        FROM transactions t
        JOIN students s ON t.student_id = s.id
        WHERE t.institution_id = ? AND DATE(t.date) = ?
        ORDER BY t.date DESC
      `, [institutionId, date], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Calculate daily summary
    const totalRevenue = transactions.reduce((sum, t) => sum + parseFloat(t.total || 0), 0);
    const totalTransactions = transactions.length;
    const averageTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Hostel Canteen System';
    workbook.created = new Date();

    // Summary Sheet
    const summarySheet = workbook.addWorksheet('Daily Summary');
    summarySheet.columns = [
      { header: 'Report Date', key: 'date', width: 15 },
      { header: 'Institution', key: 'institution', width: 25 },
      { header: 'Total Transactions', key: 'transactions', width: 18 },
      { header: 'Total Revenue (₹)', key: 'revenue', width: 18 },
      { header: 'Average Transaction (₹)', key: 'average', width: 22 }
    ];

    summarySheet.addRow({
      date: date,
      institution: req.session.institutionName || 'Default School',
      transactions: totalTransactions,
      revenue: totalRevenue.toFixed(2),
      average: averageTransaction.toFixed(2)
    });

    // Style the summary sheet
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6F3FF' }
    };

    // Transactions Sheet
    const transactionsSheet = workbook.addWorksheet('Transactions');
    transactionsSheet.columns = [
      { header: 'Date & Time', key: 'datetime', width: 20 },
      { header: 'Student Name', key: 'student_name', width: 20 },
      { header: 'Card Number', key: 'card_number', width: 15 },
      { header: 'Items Purchased', key: 'items', width: 30 },
      { header: 'Total Amount (₹)', key: 'total', width: 15 }
    ];

    // Add transaction rows
    transactions.forEach(transaction => {
      let itemsText = 'N/A';
      try {
        const items = JSON.parse(transaction.products || '{}');
        itemsText = Object.entries(items).map(([name, qty]) => `${name} (${qty})`).join(', ');
      } catch (e) {
        itemsText = 'N/A';
      }

      transactionsSheet.addRow({
        datetime: transaction.date ? new Date(transaction.date).toLocaleString() : 'N/A',
        student_name: transaction.student_name || 'Unknown',
        card_number: transaction.card_number || 'N/A',
        items: itemsText,
        total: transaction.total ? parseFloat(transaction.total).toFixed(2) : '0.00'
      });
    });

    // Style the transactions sheet
    transactionsSheet.getRow(1).font = { bold: true };
    transactionsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6F3FF' }
    };

    // Set response headers
    const fileName = `daily-report-${date}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error generating Excel report:', error);
    res.status(500).send('Error generating report: ' + error.message);
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});