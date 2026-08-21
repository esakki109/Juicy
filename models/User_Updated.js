/**
 * User Model Update - Add FCM Token Field
 * 
 * Update your backend/models/User.js to include fcmToken field
 */

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  profilePic: {
    type: String,
    default: null,
  },
  profileImage: {
    type: String, // Base64 or URL
    default: null,
  },
  bio: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['online', 'offline', 'away'],
    default: 'offline',
  },
  friends: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  ],
  blockedUsers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  ],
  friendRequests: [
    {
      from: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending',
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  // 🔥 NEW: Add FCM Token for push notifications
  fcmToken: {
    type: String,
    default: null,
    sparse: true, // Allow multiple users without fcmToken (for web users)
  },
  
  // Optional: Store multiple FCM tokens (for multiple devices)
  fcmTokens: [
    {
      token: String,
      device: String, // e.g., "iPad", "Android Phone"
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt field before saving
userSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Helper method to add FCM token
userSchema.methods.addFCMToken = function (token, device = 'unknown') {
  // Check if token already exists
  const existingIndex = this.fcmTokens.findIndex(t => t.token === token);
  
  if (existingIndex > -1) {
    // Update existing token's timestamp
    this.fcmTokens[existingIndex].createdAt = new Date();
  } else {
    // Add new token (keep max 5 tokens)
    this.fcmTokens.push({ token, device, createdAt: new Date() });
    if (this.fcmTokens.length > 5) {
      this.fcmTokens.shift(); // Remove oldest token
    }
  }
  
  // Also set the primary fcmToken
  this.fcmToken = token;
  return this.save();
};

// Helper method to remove FCM token
userSchema.methods.removeFCMToken = function (token) {
  this.fcmTokens = this.fcmTokens.filter(t => t.token !== token);
  if (this.fcmToken === token) {
    this.fcmToken = this.fcmTokens.length > 0 ? this.fcmTokens[0].token : null;
  }
  return this.save();
};

module.exports = mongoose.model('User', userSchema);

/**
 * Migration: Update existing User collection
 * Run this once to add fcmToken field to all existing users:
 * 
 * db.users.updateMany({}, { $set: { fcmToken: null, fcmTokens: [] } })
 */
