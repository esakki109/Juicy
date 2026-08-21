/**
 * Push Notification Service - Backend
 * Sends FCM notifications to users
 * 
 * Note: Firebase Admin SDK is initialized in server.js
 * This service uses the already-initialized admin instance
 */

const admin = require('firebase-admin');

/**
 * Send notification to a specific user
 * Uses DATA-ONLY messages so Android MyFirebaseMessagingService always fires
 * (even in background/killed state) and handles display.
 * 
 * @param {string} fcmToken - Recipient's FCM token
 * @param {object} notification - Notification payload
 */
async function sendNotificationToUser(fcmToken, notification) {
  if (!fcmToken) {
    console.warn('⚠️ No FCM token provided');
    return;
  }

  // Convert all data values to strings (FCM data payload requires string values)
  const dataPayload = {};
  if (notification.data) {
    for (const [key, value] of Object.entries(notification.data)) {
      dataPayload[key] = String(value || '');
    }
  }
  // Include title and body in data payload so MyFirebaseMessagingService can read them
  dataPayload.title = notification.title || '';
  dataPayload.body = notification.body || '';
  if (notification.channelId) dataPayload.channelId = notification.channelId;
  if (notification.imageUrl) dataPayload.imageUrl = notification.imageUrl;

  const message = {
    // FCM token goes INSIDE the message object (not as separate argument)
    token: fcmToken,
    // DATA-ONLY message — no "notification" key — ensures onMessageReceived fires always
    data: dataPayload,
    android: {
      // HIGH priority wakes the device from Doze mode (like WhatsApp)
      priority: 'high',
      ttl: 86400000, // 24 hours in milliseconds
    },
    apns: {
      headers: {
        'apns-priority': '10', // High priority for iOS
      },
      payload: {
        aps: {
          alert: {
            title: notification.title,
            body: notification.body,
          },
          sound: 'default',
          badge: 1,
          'content-available': 1, // Wake app in background on iOS
        },
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Notification sent:', response);
    return response;
  } catch (error) {
    console.error('❌ Error sending notification:', error.code, error.message);
    // If token is invalid/expired, return special marker so caller can clean up
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      console.warn('⚠️ FCM token is invalid/expired. Should be removed from database.');
      return { error: 'invalid_token' };
    }
    return null;
  }
}

/**
 * Send message notification to recipient
 */
async function sendMessageNotification(recipientUser, sender, messageText) {
  if (!recipientUser.fcmToken) {
    console.warn('⚠️ Recipient has no FCM token');
    return;
  }

  const notification = {
    title: sender.username,
    body: messageText.substring(0, 100), // Truncate to 100 chars
    data: {
      senderId: sender._id.toString(),
      senderName: sender.username,
      conversationId: [sender._id, recipientUser._id].sort().join('-'),
      type: 'message',
      timestamp: new Date().toISOString(),
    },
    channelId: 'chat_messages',
    imageUrl: sender.profilePic, // Optional: sender's profile pic
  };

  return sendNotificationToUser(recipientUser.fcmToken, notification);
}

/**
 * Send incoming call notification
 */
async function sendCallNotification(recipientUser, caller, callType = 'audio', signal = null) {
  if (!recipientUser.fcmToken) {
    console.warn('⚠️ Recipient has no FCM token');
    return;
  }

  const notification = {
    title: `${caller.username} is calling...`,
    body: callType === 'video' ? 'Video call' : 'Voice call',
    data: {
      senderId: caller._id.toString(),
      senderName: caller.username,
      receiverId: recipientUser._id.toString(),
      type: 'incoming_call',
      callType: callType,
      callId: `call_${Date.now()}`,
      timestamp: new Date().toISOString(),
      callerImage: caller.profilePic || '',
      signal: signal ? (typeof signal === 'string' ? signal : JSON.stringify(signal)) : '',
    },
    channelId: 'call_notifications',
  };

  return sendNotificationToUser(recipientUser.fcmToken, notification);
}

/**
 * Send friend request notification
 */
async function sendFriendRequestNotification(recipientUser, requester) {
  if (!recipientUser.fcmToken) {
    console.warn('⚠️ Recipient has no FCM token');
    return;
  }

  const notification = {
    title: 'Friend Request',
    body: `${requester.username} sent you a friend request`,
    data: {
      senderId: requester._id.toString(),
      senderName: requester.username,
      type: 'friend_request',
      timestamp: new Date().toISOString(),
    },
    channelId: 'friend_requests',
  };

  return sendNotificationToUser(recipientUser.fcmToken, notification);
}

/**
 * Send notification to multiple users (topic)
 */
async function sendTopicNotification(topic, notification) {
  // Convert all data values to strings
  const dataPayload = {};
  if (notification.data) {
    for (const [key, value] of Object.entries(notification.data)) {
      dataPayload[key] = String(value || '');
    }
  }
  dataPayload.title = notification.title || '';
  dataPayload.body = notification.body || '';

  const message = {
    data: dataPayload,
    topic: topic,
    android: {
      priority: 'high',
      ttl: 86400000,
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Topic notification sent:', response);
    return response;
  } catch (error) {
    console.error('❌ Error sending topic notification:', error);
    return null;
  }
}

/**
 * Subscribe user to topic
 */
async function subscribeToTopic(fcmTokens, topic) {
  try {
    await admin.messaging().subscribeToTopic(fcmTokens, topic);
    console.log(`✅ Subscribed to topic: ${topic}`);
  } catch (error) {
    console.error('❌ Error subscribing to topic:', error);
  }
}

/**
 * Unsubscribe user from topic
 */
async function unsubscribeFromTopic(fcmTokens, topic) {
  try {
    await admin.messaging().unsubscribeFromTopic(fcmTokens, topic);
    console.log(`✅ Unsubscribed from topic: ${topic}`);
  } catch (error) {
    console.error('❌ Error unsubscribing from topic:', error);
  }
}

module.exports = {
  sendNotificationToUser,
  sendMessageNotification,
  sendCallNotification,
  sendFriendRequestNotification,
  sendTopicNotification,
  subscribeToTopic,
  unsubscribeFromTopic,
};
