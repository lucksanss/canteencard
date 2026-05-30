# Canteen Card — Deployment Guide

## Files in this project

```
canteen/
├── server.js              # Main Express server
├── db.js                  # PostgreSQL connection + auto-creates tables
├── package.json
├── .env.example           # Copy to .env and fill in values
├── .gitignore
├── middleware/
│   └── auth.js            # Session auth guard
├── routes/
│   ├── auth.js            # /api/auth — login, register, logout
│   ├── products.js        # /api/products — CRUD + /restock (fixes the bug!)
│   ├── cards.js           # /api/cards — CRUD + top-up
│   └── transactions.js    # /api/transactions — sell + stats
└── public/
    └── index.html         # Complete frontend SPA
```

---

## How to deploy on Render (step by step)

### 1. Upload your code to GitHub
- Create a new GitHub repo (free at github.com)
- Upload all these files maintaining the folder structure above

### 2. Create a PostgreSQL database on Render
- Go to render.com → New → PostgreSQL
- Give it a name (e.g. `canteen-db`)
- Copy the **Internal Database URL** once created

### 3. Create a Web Service on Render
- New → Web Service → connect your GitHub repo
- Settings:
  - **Build Command:** `npm install`
  - **Start Command:** `node server.js`
  - **Node version:** 18+

### 4. Add Environment Variables in Render
In your web service → Environment tab, add:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Paste the Internal Database URL from step 2 |
| `SESSION_SECRET` | Any long random string e.g. `myschool-canteen-2024-xk9z` |
| `NODE_ENV` | `production` |

### 5. Deploy
Click **Deploy** — Render will install packages, start the server,
and the database tables will be created automatically on first boot.

---

## The restock fix

The old site couldn't add stock to a zero-stock product.

Now there's a dedicated **Restock** button on every product (including
out-of-stock ones) that calls `POST /api/products/:id/restock` with
`{ quantity: N }`. This uses SQL `stock = stock + N` so it always
adds to whatever the current value is — zero or otherwise.

---

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Create .env from template
cp .env.example .env
# Edit .env with your local PostgreSQL URL

# 3. Run in dev mode (auto-restarts on changes)
npm run dev
```
