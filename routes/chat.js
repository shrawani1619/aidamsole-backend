const express = require('express');
const router = express.Router();
const {
  getConversations, createConversation,
  getMessages, sendMessage, deleteMessage, getChatUsers
} = require('../controllers/chatController');
const { protect, departmentScope } = require('../middleware/auth');

router.use(protect, departmentScope);

router.get('/users', getChatUsers);
router.get('/conversations', getConversations);
router.post('/conversations', createConversation);
router.get('/conversations/:id/messages', getMessages);
router.post('/conversations/:id/messages', sendMessage);
router.delete('/messages/:id', deleteMessage);

module.exports = router;
