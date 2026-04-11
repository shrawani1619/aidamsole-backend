const { Conversation, Message } = require('../models/Chat');
const User = require('../models/User');

// @GET /api/chat/conversations
exports.getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .populate('participants', 'name email avatar role')
      .populate('lastMessage.senderId', 'name avatar')
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ success: true, conversations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/chat/conversations
exports.createConversation = async (req, res) => {
  try {
    const { type = 'direct', participantIds, name, clientId, projectId } = req.body;
    const allParticipants = [...new Set([String(req.user._id), ...participantIds])];

    // Check existing direct conversation
    if (type === 'direct' && allParticipants.length === 2) {
      const existing = await Conversation.findOne({
        type: 'direct',
        participants: { $all: allParticipants, $size: 2 }
      }).populate('participants', 'name email avatar');
      if (existing) return res.json({ success: true, conversation: existing });
    }

    const conversation = await Conversation.create({
      type, name, clientId, projectId,
      participants: allParticipants
    });

    const populated = await Conversation.findById(conversation._id)
      .populate('participants', 'name email avatar role');
    res.status(201).json({ success: true, conversation: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/chat/conversations/:id/messages
exports.getMessages = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const skip = (page - 1) * limit;

    const messages = await Message.find({ conversationId: req.params.id, isDeleted: false })
      .populate('senderId', 'name email avatar')
      .sort({ createdAt: -1 })
      .skip(skip).limit(limit)
      .lean();

    // Mark as read
    await Message.updateMany(
      { conversationId: req.params.id, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    res.json({ success: true, messages: messages.reverse(), page });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @POST /api/chat/conversations/:id/messages
exports.sendMessage = async (req, res) => {
  try {
    const { text, type = 'text', fileUrl, fileName } = req.body;
    const message = await Message.create({
      conversationId: req.params.id,
      senderId: req.user._id,
      type, text, fileUrl, fileName,
      readBy: [req.user._id]
    });

    // Update conversation last message
    await Conversation.findByIdAndUpdate(req.params.id, {
      lastMessage: { text: text || `[${type}]`, senderId: req.user._id, timestamp: new Date() }
    });

    const populated = await Message.findById(message._id).populate('senderId', 'name email avatar');

    // Emit via socket
    req.app.get('io')?.to(req.params.id).emit('chat:message', populated);

    res.status(201).json({ success: true, message: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/chat/messages/:id
exports.deleteMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    if (String(message.senderId) !== String(req.user._id) && !['super_admin', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    message.isDeleted = true;
    message.text = 'This message was deleted';
    await message.save();
    res.json({ success: true, message: 'Message deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/chat/users
exports.getChatUsers = async (req, res) => {
  try {
    const filter = { isActive: true, _id: { $ne: req.user._id } };
    if (req.scopeDepartment) filter.departmentId = req.scopeDepartment;
    const users = await User.find(filter).select('name email avatar role departmentId departmentRole').populate('departmentId', 'name color').lean();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
