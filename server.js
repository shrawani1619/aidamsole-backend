const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

/** Match browser `Origin` (no path); trim and strip trailing slashes from env typos. */
function normalizeCorsOrigin(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/\/+$/, '');
}

/** Comma-separated origins in FRONTEND_URL (e.g. http://localhost:3000,https://app.vercel.app). */
function parseCorsOrigins() {
  const raw = process.env.FRONTEND_URL || 'http://localhost:3000';
  const list = raw.split(',').map((s) => normalizeCorsOrigin(s)).filter(Boolean);
  return [...new Set(list)];
}
const corsOrigins = parseCorsOrigins();

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Socket.io setup
const io = socketIo(server, {
  cors: {
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Make io accessible to routes
app.set('io', io);

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS — `Origin` must match an entry in FRONTEND_URL (comma-separated on Render).
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalized = normalizeCorsOrigin(origin);
      if (corsOrigins.includes(normalized)) return callback(null, true);
      console.warn('[CORS] blocked:', normalized, '| configured:', corsOrigins.join(' | ') || '(none)');
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Rate limiting (skip OPTIONS so preflight is never 429’d before CORS completes)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: 'Too many requests, please try again later.' },
  skip: (req) => req.method === 'OPTIONS',
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const DEFAULT_MONGO_URI = 'mongodb://localhost:27017/aidamsole';
const mongoFromEnv = process.env.MONGO_URI?.trim();
const usingMongoFallback = !mongoFromEnv;
const MONGO_URI = mongoFromEnv || DEFAULT_MONGO_URI;
const initDatabase = require('./utils/initDatabase');

/** Hide password in connection strings printed to the terminal */
function redactMongoUri(uri) {
  if (!uri || typeof uri !== 'string') return '(not set)';
  return uri.replace(/:([^/@?]+)@/, ':***@');
}

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/trash', require('./routes/trash'));
app.use('/api/history', require('./routes/history'));
app.use('/api/admins', require('./routes/admins'));
app.use('/api/permissions', require('./routes/permissions'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/dashboard', require('./routes/dashboard'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'AiDamsole API is running', timestamp: new Date() });
});

// Socket.io chat logic — userId (string) -> latest socket.id (for direct emits e.g. chat notifications)
const connectedUsers = {};
app.set('connectedUsers', connectedUsers);

/**
 * Reusable real-time notification broadcaster.
 * Emits a generic event plus domain-specific aliases.
 */
function sendNotification(data = {}) {
  const payload = {
    id: data.id || `notif_${Date.now()}`,
    type: data.type || 'system',
    title: data.title || 'Notification',
    message: data.message || 'You have a new update',
    ...data,
    timestamp: data.timestamp || new Date().toISOString(),
  };

  io.emit('new_notification', payload);
  // Backward compatibility for existing frontend listeners.
  io.emit('notification:new', payload);

  if (payload.type === 'message') {
    io.emit('message:new', payload);
  }
  if (payload.type === 'order_status') {
    io.emit('order:status_updated', payload);
  }

  return payload;
}

const handleTestNotification = (req, res) => {
  const { type = 'message' } = req.query;
  const customPayload = req.body || {};

  let payload;
  if (type === 'order_status') {
    payload = sendNotification({
      type: 'order_status',
      title: 'Order Update',
      message: 'Order #1234 status changed',
      orderId: '1234',
      status: 'shipped',
      ...customPayload,
    });
  } else {
    payload = sendNotification({
      type: 'message',
      title: 'New Message',
      message: 'You received a new message',
      senderName: 'System Bot',
      ...customPayload,
    });
  }

  res.json({
    success: true,
    message: 'Notification broadcasted',
    payload,
  });
};

app.post('/api/test-notification', handleTestNotification);
app.post('/test-notification', handleTestNotification);
app.get('/api/test-notification', handleTestNotification);
app.get('/test-notification', handleTestNotification);

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('user:join', (userId) => {
    const id = String(userId);
    connectedUsers[id] = socket.id;
    socket.userId = id;
    io.emit('users:online', Object.keys(connectedUsers));
  });

  socket.on('chat:message', async (data) => {
    const { conversationId, message, senderId, recipientId } = data;
    socket.to(conversationId).emit('chat:message', { ...data, timestamp: new Date() });
    // Notify recipient if online
    if (recipientId && connectedUsers[recipientId]) {
      io.to(connectedUsers[recipientId]).emit('notification:new', {
        type: 'message',
        message: 'New message received',
        senderId
      });
    }
  });

  socket.on('chat:join', (conversationId) => {
    socket.join(conversationId);
  });

  socket.on('chat:typing', (data) => {
    socket.to(data.conversationId).emit('chat:typing', data);
  });

  socket.on('task:update', (data) => {
    io.emit('task:updated', data);
  });

  // Example event for new message broadcasts.
  socket.on('message:notify', (data) => {
    sendNotification({
      type: 'message',
      title: 'New Message',
      message: data?.message || 'You received a new message',
      conversationId: data?.conversationId,
      senderId: data?.senderId,
    });
  });

  // Example event for order status updates in commerce flows.
  socket.on('order:status', (data) => {
    sendNotification({
      type: 'order_status',
      title: 'Order Status Updated',
      message: data?.message || 'Order status changed',
      orderId: data?.orderId,
      status: data?.status,
    });
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      delete connectedUsers[socket.userId];
      io.emit('users:online', Object.keys(connectedUsers));
    }
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    if (!process.env.JWT_SECRET?.trim()) {
      console.error('❌ JWT_SECRET is missing or empty. Login will fail. Set JWT_SECRET in Render → Environment.');
      process.exit(1);
    }

    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connected');
    console.log(
      usingMongoFallback
        ? '   source: default fallback (MONGO_URI missing or empty in .env — using local MongoDB)'
        : '   source: MONGO_URI from environment (.env)'
    );
    console.log(`   ${redactMongoUri(MONGO_URI)}`);
    console.log(`   database: "${mongoose.connection.name}"`);

    await initDatabase();

    require('./utils/cronJobs')(io);

    server.listen(PORT, () => {
      console.log(`🚀 AiDamsole Server running on port ${PORT}`);
      console.log(`🌐 CORS allowed origins (${corsOrigins.length}): ${corsOrigins.join(' | ')}`);
    });
  } catch (err) {
    console.error('❌ Server failed to start:', err.message || err);
    process.exit(1);
  }
}

start();

module.exports = { app, io, sendNotification };
