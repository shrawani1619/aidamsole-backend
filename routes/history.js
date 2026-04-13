const express = require('express');
const router = express.Router();
const { getHistory } = require('../controllers/historyController');
const { protect, departmentScope } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/', requireModuleAction('history', 'view'), getHistory);

module.exports = router;
