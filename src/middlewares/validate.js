module.exports = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (err) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      details: err.errors
    });
  }
};
