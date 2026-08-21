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
