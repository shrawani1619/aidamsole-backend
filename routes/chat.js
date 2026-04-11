const express = require('express');
const router = express.Router();
const {
  getConversations, createConversation,
  getMessages, sendMessage, deleteMessage, getChatUsers
} = require('../controllers/chatController');
const { protect, departmentScope } = require('../middleware/auth');
const { requireModuleAction } = require('../middleware/permissions');

router.use(protect, departmentScope);

router.get('/users', requireModuleAction('chat', 'view'), getChatUsers);
router.get('/conversations', requireModuleAction('chat', 'view'), getConversations);
router.post('/conversations', requireModuleAction('chat', 'create'), createConversation);
router.get('/conversations/:id/messages', requireModuleAction('chat', 'view'), getMessages);
router.post('/conversations/:id/messages', requireModuleAction('chat', 'create'), sendMessage);
router.delete('/messages/:id', requireModuleAction('chat', 'delete'), deleteMessage);

module.exports = router;
