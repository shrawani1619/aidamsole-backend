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
    const uid = String(req.user._id);

    // Clear unread badge for this user when opening the thread
    const convRead = await Conversation.findById(req.params.id);
    if (convRead) {
      if (!convRead.unreadCount) convRead.unreadCount = new Map();
      convRead.unreadCount.set(uid, 0);
      await convRead.save();
    }

    const messages = await Message.find({
      conversationId: req.params.id,
      deletedFor: { $ne: req.user._id }
    })
      .populate('senderId', 'name email avatar')
      .sort({ createdAt: -1 })
      .skip(skip).limit(limit)
      .lean();

    // Mark messages as read
    await Message.updateMany(
      { conversationId: req.params.id, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    // Oldest first in array → UI shows latest at bottom (WhatsApp-style)
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

    const populated = await Message.findById(message._id).populate('senderId', 'name email avatar');

    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers') || {};
    const convId = String(req.params.id);
    const me = String(req.user._id);

    // Last message + per-user unread (skip increment if recipient has this chat open in a joined socket room)
    const convDoc = await Conversation.findById(req.params.id);
    if (convDoc) {
      convDoc.lastMessage = {
        text: text || `[${type}]`,
        senderId: req.user._id,
        timestamp: new Date(),
      };
      const roomSockets = io?.sockets?.adapter?.rooms?.get(convId);
      if (!convDoc.unreadCount) convDoc.unreadCount = new Map();
      for (const p of convDoc.participants || []) {
        const uid = String(p._id ?? p);
        if (uid === me) continue;
        const recipientSocketId = connectedUsers[uid];
        const viewingThisChat = recipientSocketId && roomSockets && roomSockets.has(recipientSocketId);
        if (viewingThisChat) continue;
        const cur = convDoc.unreadCount.get(uid) ?? 0;
        convDoc.unreadCount.set(uid, cur + 1);
      }
      await convDoc.save();
    }

    // Room: clients joined to this conversation get full payload (open chat UI)
    io?.to(convId).emit('chat:message', populated);

    // Silent push to other participants (no sound in app — unread badge only)
    const preview = populated.text
      ? String(populated.text).slice(0, 120)
      : populated.type === 'image'
        ? 'Image'
        : populated.type === 'file'
          ? 'File'
          : 'New message';
    const notifyParticipants = convDoc?.participants || [];
    for (const pid of notifyParticipants) {
      const uid = String(pid._id ?? pid);
      if (uid === me) continue;
      const sockId = connectedUsers[uid];
      if (io && sockId) {
        io.to(sockId).emit('notification:new', {
          type: 'message',
          message: preview,
          conversationId: req.params.id,
          senderId: populated.senderId,
          silent: true,
          source: 'chat',
        });
      }
    }

    res.status(201).json({ success: true, message: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @DELETE /api/chat/messages/:id
exports.deleteMessage = async (req, res) => {
  try {
    const mode = req.body?.mode === 'everyone' ? 'everyone' : 'me';
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    const isSender = String(message.senderId) === String(req.user._id);
    const isAdmin = ['super_admin', 'admin'].includes(req.user.role);

    if (mode === 'everyone') {
      if (!isSender && !isAdmin) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
      message.isDeleted = true;
      message.type = 'system';
      message.text = 'This message was deleted';
      message.fileUrl = '';
      message.fileName = '';
      await message.save();
      req.app.get('io')?.to(String(message.conversationId)).emit('chat:message:update', {
        conversationId: String(message.conversationId),
        messageId: String(message._id),
        mode: 'everyone'
      });
      return res.json({ success: true, message: 'Message deleted for everyone' });
    }

    message.deletedFor = message.deletedFor || [];
    const alreadyDeletedForMe = message.deletedFor.some((id) => String(id) === String(req.user._id));
    if (!alreadyDeletedForMe) {
      message.deletedFor.push(req.user._id);
    }
    await message.save();
    res.json({ success: true, message: 'Message deleted for you' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @GET /api/chat/users
exports.getChatUsers = async (req, res) => {
  try {
    const filter = { isActive: true, deletedAt: null, _id: { $ne: req.user._id } };
    const users = await User.find(filter)
      .select('name email avatar role departmentId departmentRole departmentMemberships')
      .populate('departmentId', 'name color')
      .populate('departmentMemberships.departmentId', 'name color')
      .lean();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
