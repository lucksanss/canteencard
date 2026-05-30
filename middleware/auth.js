function requireAuth(req, res, next) {
  if (!req.session || !req.session.institutionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

module.exports = { requireAuth };
