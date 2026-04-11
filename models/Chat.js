const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  type: { type: String, enum: ['direct', 'group', 'client'], default: 'direct' },
  name: { type: String, default: '' },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  lastMessage: {
    text: String,
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: Date
  },
  unreadCount: { type: Map, of: Number, default: {} }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['text', 'file', 'image', 'system'], default: 'text' },
  text: { type: String, default: '' },
  fileUrl: { type: String, default: '' },
  fileName: { type: String, default: '' },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

messageSchema.index({ conversationId: 1, createdAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);
const Message = mongoose.model('Message', messageSchema);

module.exports = { Conversation, Message };
