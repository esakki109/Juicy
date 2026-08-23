/**
 * Backend Routes for Push Notifications
 * Add these routes to your Express app (routes/notifications.js)
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Message = require('../models/Message');
const {
  sendMessageNotification,
  sendCallNotification,
  sendFriendRequestNotification,
} = require('../services/pushNotificationService');

const isBlocked = async (user1Id, user2Id) => {
  try {
    const count = await User.countDocuments({
      $or: [
        { _id: user1Id, 'blockedUsers.userId': user2Id },
        { _id: user2Id, 'blockedUsers.userId': user1Id }
      ]
    });
    return count > 0;
  } catch (err) {
    console.error('Error in isBlocked check:', err);
    return false;
  }
};

/**
 * Save or update FCM token for user
 * POST /api/user/:userId/fcm-token
 */
router.post('/api/user/:userId/fcm-token', async (req, res) => {
  try {
    const { userId } = req.params;
    const fcmToken = req.body.fcmToken || req.body.token;
    const device = req.body.device || 'unknown';

    if (!fcmToken) {
      return res.status(400).json({ error: 'FCM token required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Add token using schema method (handles deduplication and backward compatibility)
    await user.addFCMToken(fcmToken, device);

    res.json({
      success: true,
      message: 'FCM token saved',
      fcmToken: user.fcmToken,
      fcmTokensCount: user.fcmTokens ? user.fcmTokens.length : 0,
      fcmTokens: user.fcmTokens || [],
    });
  } catch (error) {
    console.error('Error saving FCM token:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send message notification
 * Called when a new message is sent
 * POST /api/notifications/send-message
 */
router.post('/api/notifications/send-message', async (req, res) => {
  try {
    const { senderId, receiverId, messageText } = req.body;

    if (!senderId || !receiverId || !messageText) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check block list before sending notification
    const blocked = await isBlocked(senderId, receiverId);
    if (blocked) {
      return res.json({ success: false, message: 'Notification blocked due to block list relationship' });
    }

    // Get sender and recipient user details
    const [sender, recipient] = await Promise.all([
      User.findById(senderId),
      User.findById(receiverId),
    ]);

    if (!sender || !recipient) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Send notification if recipient has any registered FCM token
    if (recipient.fcmToken || (recipient.fcmTokens && recipient.fcmTokens.length > 0)) {
      await sendMessageNotification(recipient, sender, messageText);
    }

    res.json({ success: true, message: 'Notification sent' });
  } catch (error) {
    console.error('Error sending message notification:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send incoming call notification
 * POST /api/notifications/send-call
 */
router.post('/api/notifications/send-call', async (req, res) => {
  try {
    const { callerId, recipientId, callType, signal } = req.body;

    if (!callerId || !recipientId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check block list before sending notification
    const blocked = await isBlocked(callerId, recipientId);
    if (blocked) {
      return res.json({ success: false, message: 'Notification blocked due to block list relationship' });
    }

    // Get caller and recipient user details
    const [caller, recipient] = await Promise.all([
      User.findById(callerId),
      User.findById(recipientId),
    ]);

    if (!caller || !recipient) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Send call notification
    if (recipient.fcmToken || (recipient.fcmTokens && recipient.fcmTokens.length > 0)) {
      await sendCallNotification(recipient, caller, callType || 'audio', signal);
    }

    res.json({ success: true, message: 'Call notification sent' });
  } catch (error) {
    console.error('Error sending call notification:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send friend request notification
 * POST /api/notifications/send-friend-request
 */
router.post('/api/notifications/send-friend-request', async (req, res) => {
  try {
    const { senderId, recipientId } = req.body;

    if (!senderId || !recipientId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check block list before sending notification
    const blocked = await isBlocked(senderId, recipientId);
    if (blocked) {
      return res.json({ success: false, message: 'Notification blocked due to block list relationship' });
    }

    // Get requester and recipient user details
    const [requester, recipient] = await Promise.all([
      User.findById(senderId),
      User.findById(recipientId),
    ]);

    if (!requester || !recipient) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Send friend request notification
    if (recipient.fcmToken || (recipient.fcmTokens && recipient.fcmTokens.length > 0)) {
      await sendFriendRequestNotification(recipient, requester);
    }

    res.json({ success: true, message: 'Friend request notification sent' });
  } catch (error) {
    console.error('Error sending friend request notification:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Reject incoming call from background
 * POST /api/notifications/reject-call
 */
router.post('/api/notifications/reject-call', async (req, res) => {
  try {
    const { callerId, receiverId } = req.body;
    if (!callerId || !receiverId) {
      return res.status(400).json({ error: 'callerId and receiverId are required' });
    }

    console.log(`📞 Background reject-call received: callerId=${callerId}, receiverId=${receiverId}`);

    // Notify caller via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(String(callerId)).emit('callRejected', { by: receiverId });
      console.log(`Sent callRejected to caller room: ${callerId}`);
    }

    // Clean up active outgoing call cache
    const activeOutgoingCalls = req.app.get('activeOutgoingCalls');
    if (activeOutgoingCalls && activeOutgoingCalls[callerId]) {
      delete activeOutgoingCalls[callerId];
      console.log(`Cleaned up activeOutgoingCall cache for caller: ${callerId}`);
    }

    res.json({ success: true, message: 'Call rejected' });
  } catch (error) {
    console.error('Error rejecting call:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
