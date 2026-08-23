const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  senderId: String,
  senderUsername: { type: String, default: '' },   // FCM: sender display name in notifications
  receiverId: String,
  receiverUsername: { type: String, default: '' },  // FCM: receiver display name
  type: { type: String, default: 'text' },          // message type: text|image|audio|video|document|contact|location|deleted
  text: String,
  timestamp: { type: Date, default: Date.now },
  roomId: String,
  delivered: { type: Boolean, default: false },
  read: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  blocked: { type: Boolean, default: false },
  image: String,
  audio: String,
  document: String,
  documentData: String,
  contact: Object,
  location: { type: mongoose.Schema.Types.Mixed, default: null }, // location message payload
  edited: { type: Boolean, default: false },
  deletedForEveryone: { type: Boolean, default: false },
  deletedForUsers: { type: [String], default: [] },
  originalText: { type: String, default: '' },
  reactions: [{
    userId: String,
    username: String,
    emoji: String
  }],
  expiresAt: { 
    type: Date, 
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from creation
  }
});

// TTL Index: Auto-delete messages after they reach expiresAt time
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Also keep the timestamp-based TTL as fallback (604800 seconds = 7 days)
messageSchema.index({ timestamp: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('Message', messageSchema);