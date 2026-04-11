const express = require('express');
const router = express.Router();
const {
  getClients, createClient, getClient,
  updateClient, updateHealthScore, deleteClient, getClientTimeline
} = require('../controllers/clientController');
const { protect, departmentScope } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

// All routes protected — scope handled by departmentScope; module ACL enforced per method
router.use(protect, departmentScope);

router.get('/', requireModuleAction('clients', 'view'), getClients);
router.post('/', requireModuleAction('clients', 'create'), createClient);
router.get('/:id', requireModuleAction('clients', 'view'), getClient);
router.put('/:id', requireModuleAction('clients', 'edit'), updateClient);
router.put('/:id/health-score', requireModuleAction('clients', 'edit'), updateHealthScore);
router.delete('/:id', requireModuleAction('clients', 'delete'), deleteClient);
router.get('/:id/timeline', requireModuleAction('clients', 'view'), getClientTimeline);

module.exports = router;
