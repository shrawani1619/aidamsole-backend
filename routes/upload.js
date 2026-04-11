const express = require('express');
const router = express.Router();
const { uploadFile, uploadMultiple, uploadMiddleware, uploadMultipleMiddleware } = require('../controllers/uploadController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.post('/single', uploadMiddleware, uploadFile);
router.post('/multiple', uploadMultipleMiddleware, uploadMultiple);

module.exports = router;
