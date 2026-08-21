const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');
const Friend = require('../models/friend');

async function cleanupOrphans() {
  // reuse existing connection when available
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    var didConnect = true;
  }

  try {
    const allUserIds = (await User.find().select('_id')).map(u => u._id.toString());

    const users = await User.find();
    for (const u of users) {
      const origFriends = (u.friends || []).length;
      const origReqs = (u.friendRequests || []).length;
      const origBlocked = (u.blockedUsers || []).length;

      u.friends = (u.friends || []).filter(f => f && f.friendId && allUserIds.includes(String(f.friendId)));
      u.friendRequests = (u.friendRequests || []).filter(r => r && r.senderId && allUserIds.includes(String(r.senderId)));
      u.blockedUsers = (u.blockedUsers || []).filter(b => b && b.userId && allUserIds.includes(String(b.userId)));

      if (u.friends.length !== origFriends || u.friendRequests.length !== origReqs || u.blockedUsers.length !== origBlocked) {
        await u.save();
        console.log('Cleaned user refs for', u._id);
      }
    }

    await Friend.deleteMany({
      $or: [
        { sender: { $nin: allUserIds } },
        { receiver: { $nin: allUserIds } }
      ]
    });
    console.log('Removed orphan Friend docs');
  } catch (err) {
    console.error('cleanupOrphans error:', err);
    throw err;
  } finally {
    if (typeof didConnect !== 'undefined' && didConnect) {
      await mongoose.disconnect();
    }
  }
}

// allow running standalone with node scripts/cleanupOrphans.js
if (require.main === module) {
  cleanupOrphans()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = cleanupOrphans;