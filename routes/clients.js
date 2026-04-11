const express = require('express');
const router = express.Router();
const {
  getClients, createClient, getClient,
  updateClient, updateHealthScore, deleteClient, getClientTimeline
} = require('../controllers/clientController');
const { protect, departmentScope } = require('../middleware/auth');

// All routes protected — no role blocking, scope handled by departmentScope
router.use(protect, departmentScope);

router.get('/', getClients);
router.post('/', createClient);
router.get('/:id', getClient);
router.put('/:id', updateClient);
router.put('/:id/health-score', updateHealthScore);
router.delete('/:id', deleteClient);
router.get('/:id/timeline', getClientTimeline);

module.exports = router;
