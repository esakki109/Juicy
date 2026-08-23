const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true, lowercase: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, default: '', sparse: true, unique: true },
  password: { type: String, required: true },
  gender: { type: String, default: '' },
  govidproof: { type: String },
  profileImage: { type: String, default: '' },
  profileVisible: { type: Boolean, default: true },
  friendRequests: [{
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    senderUsername: String,
    senderProfilePic: String
  }],
  friends: [{
    friendId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: String,
    profilePic: String
  }],
  blockedUsers: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: String,
    profilePic: String
  }],
    moods: [{
    emoji: String,
    text: String,
    timestamp: { type: Date, default: Date.now },
    likes: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      username: String,
      profilePic: String,
      timestamp: { type: Date, default: Date.now }
    }]
  }],
  lastSeen: {
    type: Date,
    default: null
  },
  // 🔥 Push Notifications
  fcmToken: {
    type: String,
    default: null,
    sparse: true
  },
  fcmTokens: [{
    token: String,
    device: { type: String, default: 'unknown' },
    createdAt: { type: Date, default: Date.now }
  }],
  gestures: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

// Helper method to add/update an FCM token in the user's fcmTokens array
userSchema.methods.addFCMToken = function (token, device = 'unknown') {
  if (!token) return Promise.resolve(this);
  if (!this.fcmTokens) {
    this.fcmTokens = [];
  }

  const existingIndex = this.fcmTokens.findIndex(t => t.token === token);
  if (existingIndex > -1) {
    this.fcmTokens[existingIndex].createdAt = new Date();
    if (device && device !== 'unknown') {
      this.fcmTokens[existingIndex].device = device;
    }
  } else {
    this.fcmTokens.push({ token, device: device || 'unknown', createdAt: new Date() });
  }

  // Set latest token for backward compatibility
  this.fcmToken = token;
  return this.save();
};

// Helper method to remove an FCM token from the user's fcmTokens array
userSchema.methods.removeFCMToken = function (token) {
  if (!token) return Promise.resolve(this);
  if (this.fcmTokens) {
    this.fcmTokens = this.fcmTokens.filter(t => t.token !== token);
  }
  if (this.fcmToken === token) {
    this.fcmToken = (this.fcmTokens && this.fcmTokens.length > 0)
      ? this.fcmTokens[this.fcmTokens.length - 1].token
      : null;
  }
  return this.save();
};

module.exports = mongoose.model('User', userSchema);
{/*const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  gender: { type: String, required: true },
  govidproof: { type: String },
  profileImage: { type: String, default: '' },
  profileVisible: { type: Boolean, default: true },
  friendRequests: [{
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    senderUsername: String,
    senderProfilePic: String
  }],
  friends: [{
    friendId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: String,
    profilePic: String
  }],
  blockedUsers: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: String,
    profilePic: String
  }],
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);*/}
