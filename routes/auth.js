
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const axios = require('axios');


const multer = require('multer');
const path = require('path');
const passport = require('passport');


// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Make sure this folder exists
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });



// ================= Check Username Availability =================
// Called by SignUp.js on every username keystroke (debounced)
router.get('/check-username', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username || username.trim().length < 3) {
      return res.status(400).json({ exists: false, message: 'Username too short' });
    }
    const existing = await User.findOne({ username: username.trim().toLowerCase() });
    return res.json({ exists: !!existing });
  } catch (error) {
    console.error('check-username error:', error);
    return res.status(500).json({ exists: false, message: 'Server error' });
  }
});

// ================= Signup =================
router.post('/signup', upload.single('idProof'), async (req, res) => {
  try {
    const { name, username, email, phone, password, gender, profileImage } = req.body;

    // Check required fields
    if (!name || !username || !email) {
      return res.status(400).json({ message: 'Name, username, and email are required.' });
    }

    // Normalize phone number for consistent storage
    let normalizedPhone = '';
    if (phone) {
      const digitsOnly = phone.replace(/\D/g, '');

      if (phone.startsWith('+966')) {
        normalizedPhone = '+966' + digitsOnly.substring(3, 12);
      } else if (phone.startsWith('+91')) {
        normalizedPhone = '+91' + digitsOnly.substring(2, 12);
      } else if (phone.startsWith('+1')) {
        normalizedPhone = '+1' + digitsOnly.substring(1, 11);
      } else if (phone.startsWith('+')) {
        normalizedPhone = '+' + digitsOnly;
      } else if (phone.startsWith('91') && !phone.startsWith('91 ')) {
        normalizedPhone = '+91' + digitsOnly.substring(2, 12);
      } else {
        normalizedPhone = '+1' + digitsOnly.substring(0, 10);
      }
    }

    // Check for duplicate username, email, phone
    const duplicate = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username.toLowerCase() },
        ...(normalizedPhone ? [{ phone: normalizedPhone }] : [])
      ]
    });

    if (duplicate) {
      let field = '';
      let message = '';

      if (duplicate.email === email.toLowerCase()) {
        field = 'email';
        message = 'Email already registered.';
      } else if (duplicate.username === username.toLowerCase()) {
        field = 'username';
        message = 'Username already taken.';
      } else if (normalizedPhone && duplicate.phone === normalizedPhone) {
        field = 'phone';
        message = 'Phone number already registered.';
      } else {
        message = 'User already exists with similar details.';
      }

      console.log(`⚠️ Signup conflict: ${field} - ${message}`);
      return res.status(409).json({ message, field });
    }

    // Handle file upload
    let govidproof = '';
    if (req.file) {
      govidproof = req.file.filename;
    }

    const user = new User({
      name,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      phone: normalizedPhone,
      password: password || '',
      gender: gender || '',
      govidproof,
      profileImage: profileImage || '',
    });

    await user.save();

    console.log('✅ User registered:', { name, username, email, phone: normalizedPhone });
    res.status(201).json({ message: 'User registered successfully.' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});



// ================= Get Message History =================
router.get('/messages/:userId/:otherUserId', async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const Message = require('../models/Message');

    // Fetch all messages between these two users (both directions)
    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId }
      ]
    })
      .sort({ timestamp: 1 }) // oldest first
      .select('-__v');

    // Filter out:
    // 1. Messages deleted by the requesting user (userId) for themselves
    // 2. Messages sent by blockee while blocked (if any)
    const filteredMessages = messages.filter(msg => {
      if (msg.deletedForUsers && msg.deletedForUsers.includes(String(userId))) {
        return false;
      }
      if (String(msg.senderId) === String(otherUserId) && msg.blocked === true) {
        return false;
      }
      return true;
    });

    res.json(filteredMessages);
  } catch (err) {
    console.error('Error fetching message history:', err);
    res.status(500).json({ error: 'Failed to fetch message history' });
  }
});

// ================= Delete/Clear Message History =================
router.delete('/messages/:userId/:otherUserId', async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const Message = require('../models/Message');

    // Delete all messages between these two users (both directions)
    await Message.deleteMany({
      $or: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId }
      ]
    });

    res.json({ message: 'Chat history cleared' });
  } catch (err) {
    console.error('Error clearing chat history:', err);
    res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

// ================= Delete Message for Me =================
router.post('/messages/:messageId/delete-for-me', async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body;
    const Message = require('../models/Message');

    const msg = await Message.findById(messageId);
    if (!msg) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (!msg.deletedForUsers) {
      msg.deletedForUsers = [];
    }

    const userIdStr = String(userId);
    if (!msg.deletedForUsers.includes(userIdStr)) {
      msg.deletedForUsers.push(userIdStr);
    }

    // Optimization: If both sender and receiver deleted the message, delete it entirely from database
    const bothDeleted = msg.deletedForUsers.includes(String(msg.senderId)) && msg.deletedForUsers.includes(String(msg.receiverId));
    if (bothDeleted) {
      await Message.findByIdAndDelete(messageId);
      return res.json({ message: 'Message completely deleted' });
    } else {
      await msg.save();
      return res.json({ message: 'Message deleted for user successfully' });
    }
  } catch (err) {
    console.error('Error deleting message for user:', err);
    res.status(500).json({ error: 'Failed to delete message for user' });
  }
});


// ================= Signup =================
router.post('/signup', upload.single('idProof'), async (req, res) => {
  try {
    const { name, username, email, phone, password, gender, profileImage } = req.body;

    // Check required fields for social login
    if (!name || !username || !email) {
      return res.status(400).json({ message: 'Name, username, and email are required.' });
    }

    // Normalize phone number for consistent storage
    let normalizedPhone = '';
    if (phone) {
      const digitsOnly = phone.replace(/\D/g, '');

      if (phone.startsWith('+966')) {
        normalizedPhone = '+966' + digitsOnly.substring(3, 12); // +966XXXXXXXXX
      } else if (phone.startsWith('+91')) {
        normalizedPhone = '+91' + digitsOnly.substring(2, 12); // +91XXXXXXXXXX
      } else if (phone.startsWith('+1')) {
        normalizedPhone = '+1' + digitsOnly.substring(1, 11); // +1XXXXXXXXXX
      } else if (phone.startsWith('+')) {
        normalizedPhone = '+' + digitsOnly;
      } else if (phone.startsWith('91') && !phone.startsWith('91 ')) {
        normalizedPhone = '+91' + digitsOnly.substring(2, 12);
      } else {
        normalizedPhone = '+1' + digitsOnly.substring(0, 10); // Default to +1 for plain 10-digit
      }


    }

    // Check for duplicate username, email, phone
    const duplicate = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username.toLowerCase() },
        ...(normalizedPhone ? [{ phone: normalizedPhone }] : [])
      ]
    });

    if (duplicate) {
      let field = '';
      let message = '';

      if (duplicate.email === email.toLowerCase()) {
        field = 'email';
        message = 'Email already registered.';
      } else if (duplicate.username === username.toLowerCase()) {
        field = 'username';
        message = 'Username already taken.';
      } else if (normalizedPhone && duplicate.phone === normalizedPhone) {
        field = 'phone';
        message = 'Phone number already registered.';
      } else {
        // Fallback - shouldn't happen but just in case
        message = 'User already exists with similar details.';
      }

      console.log(`⚠️ Signup conflict: ${field} - ${message}`);
      return res.status(409).json({ message, field });
    }

    // Handle file upload
    let govidproof = '';
    if (req.file) {
      govidproof = req.file.filename;
    }

    // For social login, password/phone/gender may be empty
    const user = new User({
      name,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      phone: normalizedPhone,
      password: password || '', // You may want to generate a random string or leave blank
      gender: gender || '',
      govidproof,
      profileImage: profileImage || '', // ✅ Save the profileImage base64 string
    });

    await user.save();



    console.log('✅ User registered:', { name, username, email, phone: normalizedPhone });
    res.status(201).json({ message: 'User registered successfully.' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ================= Login =================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email/Username and password are required' });
    }

    // Find user by email OR username (both lowercase for consistency)
    const user = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: email.toLowerCase() }
      ]
    });

    if (!user || user.password !== password) {
      console.log('❌ Login failed: Invalid credentials for', email);
      return res.status(401).json({ message: 'Invalid email/username or password' });
    }

    // Generate JWT token (expires in 30 days)
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'juicy_jwt_secret_key_2026_default',
      { expiresIn: '30d' }
    );

    // Print user ID to console
    console.log('✅ User logged in:', { id: user._id, username: user.username, email: user.email });

    res.status(200).json({ message: 'Login successful', token, user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ================= Google Login =================
router.post('/google-login', async (req, res) => {
  try {
    const { credential, email: bodyEmail, name: bodyName, picture: bodyPicture, googleId: bodyGoogleId, phone: bodyPhone } = req.body;

    let email = bodyEmail;
    let name = bodyName;
    let picture = bodyPicture;
    let googleId = bodyGoogleId;

    // If Google ID token (credential) is passed, verify and parse payload
    if (credential) {
      try {
        // Try verifying via Google TokenInfo API first
        const tokenRes = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
        if (tokenRes.data && tokenRes.data.email) {
          email = tokenRes.data.email;
          name = tokenRes.data.name || tokenRes.data.given_name || name;
          picture = tokenRes.data.picture || picture;
          googleId = tokenRes.data.sub || googleId;
        }
      } catch (tokenErr) {
        console.warn('Google tokeninfo fetch failed, falling back to JWT payload decode:', tokenErr.message);
        try {
          const parts = credential.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
            email = payload.email || email;
            name = payload.name || payload.given_name || name;
            picture = payload.picture || picture;
            googleId = payload.sub || googleId;
          }
        } catch (e) {
          console.error('Failed to parse credential payload:', e);
        }
      }
    }

    if (!email) {
      return res.status(400).json({ message: 'Google authentication failed: Email not found.' });
    }

    email = email.toLowerCase();

    // Check if user already exists with this email
    let user = await User.findOne({ email });

    const cleanPhone = bodyPhone && bodyPhone.trim() ? bodyPhone.trim() : undefined;

    if (!user) {
      // User does not exist, create a new account automatically
      // Generate a unique username based on email handle
      const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '');
      let username = baseUsername;
      let counter = 1;
      while (await User.findOne({ username })) {
        username = `${baseUsername}${counter}`;
        counter++;
      }

      const randomPassword = 'google_' + Math.random().toString(36).slice(-10);

      const userFields = {
        name: name || baseUsername,
        username,
        email,
        password: randomPassword,
        profileImage: picture || '',
      };
      if (cleanPhone) userFields.phone = cleanPhone;

      user = new User(userFields);
      await user.save();
      console.log('✅ New Google user registered:', { id: user._id, username: user.username, email: user.email, phone: user.phone });
    } else {
      // User exists, update profile picture or phone if provided
      let updated = false;
      if (!user.profileImage && picture) {
        user.profileImage = picture;
        updated = true;
      }
      if (!user.phone && cleanPhone) {
        user.phone = cleanPhone;
        updated = true;
      }
      if (updated) {
        await user.save();
      }
      console.log('✅ Existing Google user logged in:', { id: user._id, username: user.username, email: user.email, phone: user.phone });
    }

    // Generate JWT token (expires in 30 days)
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || 'juicy_jwt_secret_key_2026_default',
      { expiresIn: '30d' }
    );

    const requirePhone = !Boolean(user.phone && user.phone.trim());

    return res.status(200).json({
      message: 'Google login successful',
      token,
      user,
      requirePhone
    });
  } catch (err) {
    console.error('Google login server error:', err);
    return res.status(500).json({ message: 'Google authentication failed. Server error.' });
  }
});

// ================= Save Google Phone Number =================
router.post('/save-google-phone', async (req, res) => {
  try {
    const { userId, phone } = req.body;
    if (!userId || !phone || !phone.trim()) {
      return res.status(400).json({ message: 'User ID and mobile number are required.' });
    }
    const cleanPhone = phone.trim();

    // Check if phone number is already registered to another account
    const existing = await User.findOne({ phone: cleanPhone, _id: { $ne: userId } });
    if (existing) {
      return res.status(400).json({ message: 'This mobile number is already registered with another account.' });
    }

    const user = await User.findByIdAndUpdate(userId, { phone: cleanPhone }, { new: true });
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    console.log('✅ Updated phone for Google user:', { id: user._id, phone: user.phone });
    return res.status(200).json({ message: 'Mobile number saved successfully.', user });
  } catch (err) {
    console.error('Error saving Google phone:', err);
    return res.status(500).json({ message: 'Server error while saving mobile number.' });
  }
});

// Middleware to authenticate JWT tokens
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'Authentication token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'juicy_jwt_secret_key_2026_default');
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.warn('JWT verification failed:', err.message);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Token verification endpoint (used on startup)
router.get('/verify-token', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ valid: false, message: 'Authentication token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'juicy_jwt_secret_key_2026_default');
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ valid: false, message: 'User not found' });
    }

    return res.status(200).json({ valid: true, user });
  } catch (err) {
    return res.status(401).json({ valid: false, message: 'Invalid or expired token' });
  }
});




// ================= Search Users =================
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim() === '') {
      return res.json([]); // Return empty array if no query
    }
    const users = await User.find({
      username: { $regex: q, $options: 'i' }, // match anywhere, case-insensitive
      profileVisible: true // Only show users with public profiles
    }).select('username profileImage _id');
    // Optional: log for debugging
    console.log('Search query:', q, 'Results:', users);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// ================= Search Users by Phone Numbers =================
router.post('/search-by-phones', async (req, res) => {
  try {
    const { phoneNumbers, userId } = req.body;

    if (!phoneNumbers || !Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      console.log('No phone numbers provided');
      return res.json([]);
    }

    // Normalize input phone numbers: remove all non-digits
    const normalizedTargets = phoneNumbers.map(p => (p || '').toString().replace(/\D/g, ''));
    console.log('Searching for normalized phones:', normalizedTargets);

    // Fetch all users (except current user) and match by normalized phone suffix
    const allUsers = await User.find({ _id: { $ne: userId } }).select('username name profileImage _id phone');

    const matchedUsers = allUsers.filter(u => {
      if (!u.phone) return false;
      const userPhoneNorm = u.phone.toString().replace(/\D/g, '');
      return normalizedTargets.some(target => {
        if (!target) return false;
        // Match if exact equality or one is suffix of other
        return userPhoneNorm === target || userPhoneNorm.endsWith(target) || target.endsWith(userPhoneNorm);
      });
    });

    console.log('Phone search:', phoneNumbers.length, 'numbers searched, found', matchedUsers.length, 'users');
    res.status(200).json(matchedUsers);
  } catch (err) {
    console.error('Phone search error:', err);
    res.status(500).json({ error: 'Server Error', details: err.message });
  }
});

// ================= Last Registered Users (limit param) =================
router.get('/last-logins', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    // Sort by _id descending (MongoDB ObjectId contains creation time)
    // Only show users with public profiles
    const users = await User.find({ profileVisible: true })
      .sort({ _id: -1 })
      .limit(limit)
      .select('username profileImage _id');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// Get user by ID
router.get('/user/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Check if there is a block relation with viewerId
    let viewerId = req.query.viewerId;
    if (!viewerId && req.headers['authorization']) {
      try {
        const token = req.headers['authorization'].split(' ')[1];
        if (token) {
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'juicy_jwt_secret_key_2026_default');
          viewerId = decoded.id;
        }
      } catch (e) {
        // ignore
      }
    }

    if (viewerId) {
      const isBlockedRelation = await User.countDocuments({
        $or: [
          { _id: user._id, 'blockedUsers.userId': viewerId },
          { _id: viewerId, 'blockedUsers.userId': user._id }
        ]
      });
      if (isBlockedRelation > 0) {
        user.lastSeen = null;
        user.moods = [];
      }
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete user by ID
router.delete('/user/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Remove references from other users' arrays
    await User.updateMany(
      {
        $or: [
          { 'friends.friendId': user._id },
          { 'friendRequests.senderId': user._id },
          { 'blockedUsers.userId': user._id }
        ]
      },
      {
        $pull: {
          friends: { friendId: user._id },
          friendRequests: { senderId: user._id },
          blockedUsers: { userId: user._id }
        }
      }
    );

    // Remove Friend documents that reference this user
    const Friend = require('../models/friend');
    await Friend.deleteMany({ $or: [{ sender: user._id }, { receiver: user._id }] });

    // Optionally remove messages and other related docs
    const Message = require('../models/Message');
    await Message.deleteMany({ $or: [{ senderId: user._id }, { receiverId: user._id }] });

    // Finally delete the user
    await User.findByIdAndDelete(userId);

    res.json({ message: 'User deleted and references cleaned' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update profile image
router.put('/user/:id/profile-image', async (req, res) => {
  try {
    const { profileImage } = req.body;
    await User.findByIdAndUpdate(req.params.id, { profileImage });
    res.json({ message: 'Profile image updated' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update About field
router.put('/user/:id/about', async (req, res) => {
  try {
    const { about } = req.body;
    // Limit to 60 words
    if (about && about.split(/\s+/).length > 60) {
      return res.status(400).json({ message: 'About section must be 60 words or less.' });
    }
    await User.findByIdAndUpdate(req.params.id, { about });
    res.json({ message: 'About updated' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user general info (profileVisible, etc)
router.put('/user/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { profileVisible, messageEncryption, ...otherFields } = req.body;

    const updateData = { ...otherFields };
    if (profileVisible !== undefined) {
      updateData.profileVisible = profileVisible;
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true });

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User updated successfully', user: updatedUser });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's friends list (fixed: handle old/raw ObjectId entries and skip stale refs)
router.get('/user/:id/friends', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const friends = [];
    for (const f of (user.friends || [])) {
      const friendId = (f && f.friendId) ? f.friendId : f; // support both shapes
      if (!friendId) continue;
      const friend = await User.findById(friendId).select('username profileImage lastSeen');
      if (!friend) {
        // remove stale reference (best-effort, don't block response)
        User.updateOne(
          { _id: user._id },
          { $pull: { friends: { friendId: friendId } } }
        ).catch(() => { });
        continue;
      }
      friends.push({
        _id: friend._id,
        username: friend.username,
        profilePic: friend.profileImage || '',
        lastSeen: friend.lastSeen || null
      });
    }

    res.json(friends);
  } catch (err) {
    console.error('Get friends error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add friend to user's friend list (bi-directional) - store canonical objects
router.post('/user/:id/add-friend', async (req, res) => {
  try {
    const { friendId } = req.body;
    const user = await User.findById(req.params.id);
    const friend = await User.findById(friendId);
    if (!user || !friend) return res.status(404).json({ message: 'User not found' });

    const userHas = (u, id) => (u || []).some(f => String(f.friendId || f) === String(id));

    if (!userHas(user.friends, friend._id)) {
      user.friends.push({
        friendId: friend._id,
        username: friend.username,
        profilePic: friend.profileImage || ''
      });
      await user.save();
    }
    if (!userHas(friend.friends, user._id)) {
      friend.friends.push({
        friendId: user._id,
        username: user.username,
        profilePic: user.profileImage || ''
      });
      await friend.save();
    }
    res.json({ message: 'Friend added' });
  } catch (err) {
    console.error('Add friend error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/friendRequests
router.post('/friendRequests', async (req, res) => {
  try {
    const { senderId, senderUsername, senderProfilePic, receiverId } = req.body;
    const sender = await User.findById(senderId);
    const receiver = await User.findById(receiverId);
    if (!sender || !receiver) return res.status(404).json({ message: 'User not found' });

    const sIdStr = String(senderId);

    // Prevent sending request if already friends
    const isAlreadyFriend = (receiver.friends || []).some(f => String(f.friendId || f._id || f) === sIdStr);
    if (isAlreadyFriend) {
      return res.status(400).json({ message: 'Already friends' });
    }

    // Prevent duplicate requests
    const isAlreadyRequested = (receiver.friendRequests || []).some(r => {
      if (!r) return false;
      const id = String(r.senderId || r.from || r._id || r);
      return id === sIdStr;
    });
    if (isAlreadyRequested) {
      return res.status(409).json({ message: 'Request already sent' });
    }

    // Add request to receiver
    receiver.friendRequests.push({
      senderId: sender._id,
      senderUsername: senderUsername || sender.username,
      senderProfilePic: senderProfilePic || sender.profileImage || '',
    });
    await receiver.save();

    res.json({ message: 'Friend request sent' });
  } catch (err) {
    console.error('Send friend request error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all friend requests for a user (received) - Server Source of Truth
router.get('/user/:id/friendRequests', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const friendIdsSet = new Set((user.friends || []).map(f => String(f.friendId || f._id || f)));
    const blockedIdsSet = new Set((user.blockedUsers || []).map(b => String(b.userId || b._id || b)));
    const currentUserId = String(user._id);

    const validRequests = (user.friendRequests || []).filter(r => {
      if (!r) return false;
      const sId = String(r.senderId || r.from || r._id || r);
      if (!sId || sId === currentUserId) return false;
      if (friendIdsSet.has(sId)) return false; // Already accepted
      if (blockedIdsSet.has(sId)) return false; // Blocked user
      return true;
    });

    // If DB contained accepted or stale requests, clean up DB document silently
    if (user.friendRequests && user.friendRequests.length !== validRequests.length) {
      user.friendRequests = validRequests;
      await user.save().catch(e => console.warn('Failed to clean stale friend requests:', e));
    }

    res.json(validRequests);
  } catch (err) {
    console.error('Get friend requests error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Accept a friend request
router.post('/friendRequests/:senderId/accept', async (req, res) => {
  try {
    const receiverId = req.body.receiverId;
    const receiver = await User.findById(receiverId);
    const sender = await User.findById(req.params.senderId);
    if (!receiver || !sender) return res.status(404).json({ message: 'User not found' });

    const sIdStr = String(sender._id);
    const rIdStr = String(receiver._id);

    // Remove request from receiver
    receiver.friendRequests = (receiver.friendRequests || []).filter(r => {
      if (!r) return false;
      const sId = String(r.senderId || r.from || r._id || r);
      return sId !== sIdStr;
    });

    // Also remove from sender's friendRequests if present
    sender.friendRequests = (sender.friendRequests || []).filter(r => {
      if (!r) return false;
      const otherId = String(r.receiverId || r.senderId || r.from || r._id || r);
      return otherId !== rIdStr;
    });

    // Add each other to friends
    if (!receiver.friends.some(f => String(f.friendId || f._id || f) === sIdStr)) {
      receiver.friends.push({
        friendId: sender._id,
        username: sender.username,
        profilePic: sender.profileImage || ''
      });
    }
    if (!sender.friends.some(f => String(f.friendId || f._id || f) === rIdStr)) {
      sender.friends.push({
        friendId: receiver._id,
        username: receiver.username,
        profilePic: receiver.profileImage || ''
      });
    }
    await receiver.save();
    await sender.save();

    res.json({ message: 'Friend request accepted' });
  } catch (err) {
    console.error('Accept friend request error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reject/remove a friend request
router.post('/friendRequests/:senderId/reject', async (req, res) => {
  try {
    const receiverId = req.body.receiverId;
    const receiver = await User.findById(receiverId);
    const sender = await User.findById(req.params.senderId);

    const sIdStr = String(req.params.senderId);
    const rIdStr = String(receiverId);

    if (receiver) {
      receiver.friendRequests = (receiver.friendRequests || []).filter(r => {
        if (!r) return false;
        const sId = String(r.senderId || r.from || r._id || r);
        return sId !== sIdStr;
      });
      await receiver.save();
    }

    if (sender) {
      sender.friendRequests = (sender.friendRequests || []).filter(r => {
        if (!r) return false;
        const otherId = String(r.receiverId || r.senderId || r.from || r._id || r);
        return otherId !== rIdStr;
      });
      await sender.save();
    }

    res.json({ message: 'Friend request rejected' });
  } catch (err) {
    console.error('Reject friend request error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's friends list
router.get('/user/:id/friends', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const friends = [];
    for (const f of (user.friends || [])) {
      const friendId = (f && f.friendId) ? f.friendId : f; // support both shapes
      if (!friendId) continue;
      const friend = await User.findById(friendId).select('username profileImage lastSeen blockedUsers');
      if (!friend) {
        // remove stale reference (best-effort, don't block response)
        User.updateOne(
          { _id: user._id },
          { $pull: { friends: { friendId: friendId } } }
        ).catch(() => { });
        continue;
      }

      const hasBlockedMe = friend.blockedUsers && friend.blockedUsers.some(b => String(b.userId) === String(user._id));
      const IBlockedFriend = user.blockedUsers && user.blockedUsers.some(b => String(b.userId) === String(friend._id));

      friends.push({
        _id: friend._id,
        username: friend.username,
        profilePic: friend.profileImage || '',
        lastSeen: (hasBlockedMe || IBlockedFriend) ? null : (friend.lastSeen || null)
      });
    }

    res.json(friends);
  } catch (err) {
    console.error('Get friends error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove friend from user's friend list (robust against old shapes)
router.post('/user/:id/remove-friend', async (req, res) => {
  try {
    const userId = req.params.id;
    const { friendId } = req.body;
    const user = await User.findById(userId);
    const friend = await User.findById(friendId);
    if (!user || !friend) return res.status(404).json({ message: 'User not found' });

    user.friends = (user.friends || []).filter(f => String(f.friendId || f) !== String(friendId));
    await user.save();

    friend.friends = (friend.friends || []).filter(f => String(f.friendId || f) !== String(userId));
    await friend.save();

    res.json({ message: 'Friend removed' });
  } catch (err) {
    console.error('Remove friend error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE endpoint for removing friend (REST alias for the POST endpoint above)
router.delete('/user/:id/friends/:friendId', async (req, res) => {
  try {
    const userId = req.params.id;
    const friendId = req.params.friendId;
    const user = await User.findById(userId);
    const friend = await User.findById(friendId);
    if (!user || !friend) return res.status(404).json({ message: 'User not found' });

    user.friends = (user.friends || []).filter(f => String(f.friendId || f) !== String(friendId));
    await user.save();

    friend.friends = (friend.friends || []).filter(f => String(f.friendId || f) !== String(userId));
    await friend.save();

    res.json({ message: 'Friend removed' });
  } catch (err) {
    console.error('Remove friend error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Block a user (robust)
router.post('/user/:id/block', async (req, res) => {
  try {
    const userId = req.params.id;
    const { blockUserId } = req.body;
    const user = await User.findById(userId);
    const blockUser = await User.findById(blockUserId);
    if (!user || !blockUser) return res.status(404).json({ message: 'User not found' });

    // Keep friendship intact to match WhatsApp behavior (so unblocking doesn't require re-friending)
    if (!((user.blockedUsers || []).some(b => String(b.userId || b) === String(blockUserId)))) {
      user.blockedUsers.push({
        userId: blockUser._id,
        username: blockUser.username,
        profilePic: blockUser.profileImage || ''
      });
      await user.save();
    }
    res.json({ message: 'User blocked' });
  } catch (err) {
    console.error('Block user error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Unblock a user
router.post('/user/:id/unblock', async (req, res) => {
  try {
    const userId = req.params.id;
    const { unblockUserId } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.blockedUsers = user.blockedUsers.filter(b => !b.userId.equals(unblockUserId));
    await user.save();
    res.json({ message: 'User unblocked' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get blocked users
router.get('/user/:id/blocked', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user.blockedUsers || []);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get users who blocked me
router.get('/user/:id/blocked-by', async (req, res) => {
  try {
    const userId = req.params.id;
    const users = await User.find({ 'blockedUsers.userId': userId }).select('_id');
    res.json(users.map(u => ({ userId: u._id })));
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ================= Search Users (Enhanced) =================
router.get('/users/search', async (req, res) => {
  const { q, userId } = req.query;
  const searchRegex = new RegExp(q, 'i');
  const me = await User.findById(userId);

  // Find users who have blocked me
  const blockedMe = await User.find({ 'blockedUsers.userId': me._id }).select('_id');
  const blockedMeIds = blockedMe.map(u => u._id.toString());

  // Find users matching search, excluding blocked and private profiles
  const users = await User.find({
    $and: [
      { _id: { $ne: me._id } },
      { username: searchRegex },
      { _id: { $nin: me.blockedUsers.map(b => b.userId.toString()) } },
      { _id: { $nin: blockedMeIds } },
      { profileVisible: true } // Only show users with public profiles
    ]
  });
  res.json(users);
});

// ================= Enhanced Last Registered Users =================
router.get('/last-logins/enhanced', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.query.userId;

    // Find the logged-in user's friends and blocked users
    const me = await User.findById(userId).select('friends blockedUsers');
    const friendIds = me.friends.map(f => f.friendId);
    const blockedUserIds = me.blockedUsers.map(b => b.userId);

    // Find users who have blocked me
    const blockedMe = await User.find({ 'blockedUsers.userId': me._id }).select('_id');
    const blockedMeIds = blockedMe.map(u => u._id.toString());

    // Find last registered users, excluding the logged-in user, their friends, blocked users, and users who have blocked me
    // Also exclude users with private profiles
    const lastLoginUsers = await User.find({
      $and: [
        { _id: { $ne: userId, $nin: [...friendIds, ...blockedUserIds, ...blockedMeIds] } },
        { profileVisible: true } // Only show users with public profiles
      ]
    })
      .sort({ _id: -1 })
      .limit(limit)
      .select('username profileImage _id');

    res.json(lastLoginUsers);
  } catch (err) {
    res.status(500).json({ error: 'Server Error' });
  }
});

// ================= Forgot Password - Verification Request =================
router.post('/forgot-password/request', async (req, res) => {
  const { email, phone } = req.body;
  const user = await User.findOne({ email, phone });
  if (!user) {
    return res.status(404).json({ message: 'Email and phone do not match.' });
  }
  res.json({ message: 'User verified for password reset.' });
});

// ================= Forgot Password - Reset Password =================
router.post('/forgot-password/reset', async (req, res) => {
  const { email, phone, newPassword } = req.body;
  const user = await User.findOne({ email, phone });
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }
  user.password = newPassword;
  await user.save();
  res.json({ message: 'Password reset successful.' });
});

// ================= Moods Routes =================
// Create new mood
router.post('/moods', async (req, res) => {
  try {
    const { userId, emoji, text } = req.body;
    console.log('Creating mood for user:', userId); // Debug log

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const newMood = {
      emoji: emoji || '💭',
      text: text || '',
      timestamp: new Date(),

    };

    // Initialize moods array if it doesn't exist
    if (!user.moods) {
      user.moods = [];
    }

    user.moods.push(newMood);
    await user.save();

    const moodResponse = {
      _id: newMood._id,
      userId: user._id,
      username: user.username,
      emoji: newMood.emoji,
      text: newMood.text,
      timestamp: newMood.timestamp,
      profilePic: user.profileImage || '',
      user: {
        _id: user._id,
        username: user.username,
        profilePic: user.profileImage || ''
      }
    };

    console.log('Mood created:', moodResponse); // Debug log
    res.status(201).json(moodResponse);
  } catch (error) {
    console.error('Create mood error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get moods for user and friends
router.get('moods/:userId', async (req, res) => {
  try {


    const user = await User.findById(req.params.userId)
      .populate('friends.friendId', 'username profileImage moods');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userMoods = (user.moods || []).map(mood => ({
      _id: mood._id,
      userId: user._id,
      username: user.username,
      emoji: mood.emoji,
      text: mood.text,
      timestamp: mood.timestamp,
      profilePic: user.profileImage || '',
      user: {
        _id: user._id,
        username: user.username,
        profilePic: user.profileImage || ''
      }
    }));

    const friendMoods = user.friends.flatMap(friend =>
      (friend.friendId?.moods || []).map(mood => ({
        _id: mood._id,
        userId: friend.friendId._id,
        username: friend.friendId.username,
        emoji: mood.emoji,
        text: mood.text,
        timestamp: mood.timestamp,
        profilePic: friend.friendId.profileImage || '',
        user: {
          _id: friend.friendId._id,
          username: friend.friendId.username,
          profilePic: friend.friendId.profileImage || ''
        }
      }))
    );

    const allMoods = [...userMoods, ...friendMoods]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));


    res.json(allMoods);
  } catch (error) {
    console.error('Get moods error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Post mood
router.post('/mood', async (req, res) => {
  try {
    const { userId, emoji, text } = req.body;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const newMood = {
      emoji: emoji || '💭',
      text: text || '',
      timestamp: new Date(),

    };

    user.moods.push(newMood);
    await user.save();

    const moodResponse = {
      id: newMood._id,
      userId: user._id,
      username: user.username,
      emoji: newMood.emoji,
      text: newMood.text,
      timestamp: newMood.timestamp,
      profilePic: user.profileImage || '',
      user: {
        _id: user._id,
        username: user.username,
        profilePic: user.profileImage || ''
      }
    };

    res.status(201).json(moodResponse);
  } catch (error) {
    console.error('Create mood error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get moods for user and friends
router.get('/mood/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Database cleanup: Pull user's own expired moods from DB
    await User.updateOne(
      { _id: userId },
      { $pull: { moods: { timestamp: { $lt: twentyFourHoursAgo } } } }
    );

    const user = await User.findById(userId)
      .populate('friends.friendId', 'username profileImage moods');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // 2. Database cleanup: Pull expired moods of user's friends from DB
    const friendIds = user.friends
      .map(f => f.friendId?._id || f.friendId)
      .filter(Boolean);

    if (friendIds.length > 0) {
      await User.updateMany(
        { _id: { $in: friendIds } },
        { $pull: { moods: { timestamp: { $lt: twentyFourHoursAgo } } } }
      );
    }

    // Get user's moods (filter in memory in case populate returned them before update)
    const userMoods = user.moods
      .filter(mood => new Date(mood.timestamp) > twentyFourHoursAgo)
      .map(mood => ({
        id: mood._id,
        _id: mood._id,
        userId: user._id,
        username: user.username,
        emoji: mood.emoji,
        text: mood.text,
        timestamp: mood.timestamp,
        profilePic: user.profileImage || '',
        likes: mood.likes || [],
        user: {
          _id: user._id,
          username: user.username,
          profilePic: user.profileImage || ''
        }
      }));

    // Get friends' moods (filter in memory in case populate returned them before update)
    const friendMoods = user.friends.flatMap(friend => {
      if (!friend.friendId) return [];
      const activeMoods = (friend.friendId.moods || []).filter(
        mood => new Date(mood.timestamp) > twentyFourHoursAgo
      );
      return activeMoods.map(mood => ({
        id: mood._id,
        _id: mood._id,
        userId: friend.friendId._id,
        username: friend.friendId.username,
        emoji: mood.emoji,
        text: mood.text,
        timestamp: mood.timestamp,
        profilePic: friend.friendId.profileImage || '',
        likes: mood.likes || [],
        user: {
          _id: friend.friendId._id,
          username: friend.friendId.username,
          profilePic: friend.friendId.profileImage || ''
        }
      }));
    });

    // Combine and sort moods
    const allMoods = [...userMoods, ...friendMoods]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(allMoods);
  } catch (error) {
    console.error('Get moods error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new mood
router.post('/auth/mood', async (req, res) => {
  try {
    const { userId, emoji, text } = req.body;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const newMood = {
      emoji: emoji || '💭',
      text: text || '',
      timestamp: new Date(),

    };

    // Add to user's moods array
    if (!user.moods) {
      user.moods = [];
    }

    user.moods.push(newMood);
    await user.save();

    // Format response
    const moodResponse = {
      _id: newMood._id,
      userId: user._id,
      username: user.username,
      emoji: newMood.emoji,
      text: newMood.text,
      timestamp: newMood.timestamp,
      profilePic: user.profileImage || '',
      user: {
        _id: user._id,
        username: user.username,
        profilePic: user.profileImage || ''
      }
    };

    res.status(201).json(moodResponse);
  } catch (error) {
    console.error('Create mood error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get moods for user and friends
router.get('/auth/mood/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Database cleanup: Pull user's own expired moods from DB
    await User.updateOne(
      { _id: userId },
      { $pull: { moods: { timestamp: { $lt: twentyFourHoursAgo } } } }
    );

    const user = await User.findById(userId)
      .populate('friends.friendId', 'username profileImage moods');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // 2. Database cleanup: Pull expired moods of user's friends from DB
    const friendIds = user.friends
      .map(f => f.friendId?._id || f.friendId)
      .filter(Boolean);

    if (friendIds.length > 0) {
      await User.updateMany(
        { _id: { $in: friendIds } },
        { $pull: { moods: { timestamp: { $lt: twentyFourHoursAgo } } } }
      );
    }

    // Get user's own moods (filter in memory to match DB cleanup)
    const userMoods = (user.moods || [])
      .filter(mood => new Date(mood.timestamp) > twentyFourHoursAgo)
      .map(mood => ({
        _id: mood._id,
        id: mood._id,
        userId: user._id,
        username: user.username,
        emoji: mood.emoji,
        text: mood.text,
        timestamp: mood.timestamp,
        profilePic: user.profileImage || '',
        likes: mood.likes || [],
        user: {
          _id: user._id,
          username: user.username,
          profilePic: user.profileImage || ''
        }
      }));

    // Get friends' moods (filter in memory to match DB cleanup)
    const friendMoods = user.friends.flatMap(friend => {
      if (!friend.friendId) return [];
      const activeMoods = (friend.friendId.moods || []).filter(
        mood => new Date(mood.timestamp) > twentyFourHoursAgo
      );
      return activeMoods.map(mood => ({
        _id: mood._id,
        id: mood._id,
        userId: friend.friendId._id,
        username: friend.friendId.username,
        emoji: mood.emoji,
        text: mood.text,
        timestamp: mood.timestamp,
        profilePic: friend.friendId.profileImage || '',
        likes: mood.likes || [],
        user: {
          _id: friend.friendId._id,
          username: friend.friendId.username,
          profilePic: friend.friendId.profileImage || ''
        }
      }));
    });

    // Combine and sort all moods
    const allMoods = [...userMoods, ...friendMoods]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(allMoods);
  } catch (error) {
    console.error('Get moods error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Toggle like on a mood
router.post('/auth/moods/:moodId/like', async (req, res) => {
  try {
    const { moodId } = req.params;
    const { userId } = req.body;

    if (!userId || !moodId) {
      return res.status(400).json({ message: 'Missing parameters' });
    }

    const ownerUser = await User.findOne({ 'moods._id': moodId });
    if (!ownerUser) {
      return res.status(404).json({ message: 'Mood not found' });
    }

    const likerUser = await User.findById(userId);
    if (!likerUser) {
      return res.status(404).json({ message: 'Liker user not found' });
    }

    const moodItem = ownerUser.moods.id(moodId);
    if (!moodItem) {
      return res.status(404).json({ message: 'Mood item not found' });
    }

    if (!moodItem.likes) {
      moodItem.likes = [];
    }

    const existingLikeIndex = moodItem.likes.findIndex(
      l => String(l.userId) === String(userId)
    );

    let isLiked = false;
    if (existingLikeIndex > -1) {
      moodItem.likes.splice(existingLikeIndex, 1);
      isLiked = false;
    } else {
      moodItem.likes.push({
        userId: likerUser._id,
        username: likerUser.username,
        profilePic: likerUser.profileImage || likerUser.profilePic || '',
        timestamp: new Date()
      });
      isLiked = true;
    }

    await ownerUser.save();

    const updatedLikes = moodItem.likes.map(l => ({
      userId: l.userId,
      username: l.username,
      profilePic: l.profilePic || '',
      timestamp: l.timestamp
    }));

    res.json({
      success: true,
      isLiked,
      likesCount: updatedLikes.length,
      likes: updatedLikes,
      moodId,
      ownerUserId: ownerUser._id
    });
  } catch (error) {
    console.error('Like mood error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new mood
/* router.post('/auth/moods', async (req, res) => {
  try {
    const { userId, emoji, text } = req.body;
    console.log('Creating mood for user:', userId, emoji, text); // Debug log
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const newMood = {
      emoji: emoji || '💭',
      text: text || '',
      timestamp: new Date(),
      
    };

    // Initialize moods array if it doesn't exist
    if (!user.moods) {
      user.moods = [];
    }

    user.moods.push(newMood);
    await user.save();

    // Format response
    const moodResponse = {
      _id: newMood._id,
      userId: user._id,
      username: user.username,
      emoji: newMood.emoji,
      text: newMood.text,
      timestamp: newMood.timestamp,
      profilePic: user.profileImage || '',
      user: {
        _id: user._id,
        username: user.username,
        profilePic: user.profileImage || ''
      }
    };

    console.log('Mood created:', moodResponse); // Debug log
    res.status(201).json(moodResponse);
  } catch (error) {
    console.error('Create mood error:', error);
    res.status(500).json({ message: 'Server error' });
  }
}); */

router.post('/auth/moods', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { emoji, text } = req.body;
    console.log('Creating mood for user:', userId, emoji, text);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user has posted a mood recently (within 24 hours)
    if (user.moods && user.moods.length > 0) {
      // Get the most recent mood
      const lastMood = user.moods[user.moods.length - 1];
      const lastMoodTime = new Date(lastMood.timestamp);
      const currentTime = new Date();

      // Calculate time difference in hours
      const timeDiffHours = (currentTime - lastMoodTime) / (1000 * 60 * 60);

      // If user posted within last 24 hours, prevent new post
      if (timeDiffHours < 24) {
        const remainingHours = Math.ceil(24 - timeDiffHours);
        return res.status(429).json({
          message: `You can only post one mood per day. Please try again in ${remainingHours} hours.`,
          remainingHours: remainingHours,
          lastPostTime: lastMood.timestamp
        });
      }
    }

    const newMood = {
      emoji: emoji || '💭',
      text: text || '',
      timestamp: new Date(),
    };

    // Initialize moods array if it doesn't exist
    if (!user.moods) {
      user.moods = [];
    }

    user.moods.push(newMood);
    await user.save();

    // Format response
    const moodResponse = {
      _id: newMood._id,
      userId: user._id,
      username: user.username,
      emoji: newMood.emoji,
      text: newMood.text,
      timestamp: newMood.timestamp,
      profilePic: user.profileImage || '',
      user: {
        _id: user._id,
        username: user.username,
        profilePic: user.profileImage || ''
      }
    };

    console.log('Mood created:', moodResponse);
    res.status(201).json(moodResponse);
  } catch (error) {
    console.error('Create mood error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/auth/moods/:userId', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    if (req.user._id.toString() !== userId) {
      return res.status(403).json({ message: 'Unauthorized access' });
    }
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Database cleanup: Pull user's own expired moods from DB
    await User.updateOne(
      { _id: userId },
      { $pull: { moods: { timestamp: { $lt: twentyFourHoursAgo } } } }
    );

    const user = await User.findById(userId)
      .populate('friends.friendId', 'username profileImage moods');

    if (!user) return res.status(404).json({ message: 'User not found' });

    // 2. Database cleanup: Pull expired moods of user's friends from DB
    const friendIds = user.friends
      .map(f => f.friendId?._id || f.friendId)
      .filter(Boolean);

    if (friendIds.length > 0) {
      await User.updateMany(
        { _id: { $in: friendIds } },
        { $pull: { moods: { timestamp: { $lt: twentyFourHoursAgo } } } }
      );
    }

    // Filter user's moods (filter in memory to match DB cleanup)
    user.moods = user.moods.filter(mood =>
      new Date(mood.timestamp) > twentyFourHoursAgo
    );

    // Filter friends' moods (filter in memory to match DB cleanup)
    const filteredFriends = user.friends
      .filter(friend => friend.friendId)
      .map(friend => ({
        ...friend.toObject(),
        friendId: {
          ...friend.friendId.toObject(),
          moods: (friend.friendId.moods || []).filter(mood =>
            new Date(mood.timestamp) > twentyFourHoursAgo
          )
        }
      }));

    // Combine and format response
    const response = {
      userMoods: user.moods,
      friendMoods: filteredFriends.flatMap(f => f.friendId.moods)
    };

    res.json(response);

  } catch (error) {
    console.error('Get moods error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get moods for user and friends
{/*router.get('/auth/moods/:userId', async (req, res) => {
  try {
    console.log('Fetching moods for user:', req.params.userId); // Debug log
    
    const user = await User.findById(req.params.userId)
      .populate('friends.friendId', 'username profileImage moods');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's own moods
    const userMoods = (user.moods || []).map(mood => ({
      _id: mood._id,
      userId: user._id,
      username: user.username,
      emoji: mood.emoji,
      text: mood.text,
      timestamp: mood.timestamp,
      profilePic: user.profileImage || '',
      user: {
        _id: user._id,
        username: user.username,
        profilePic: user.profileImage || ''
      }
    }));

    // Get friends' moods
    const friendMoods = user.friends.flatMap(friend => 
      (friend.friendId?.moods || []).map(mood => ({
        _id: mood._id,
        userId: friend.friendId._id,
        username: friend.friendId.username,
        emoji: mood.emoji,
        text: mood.text,
        timestamp: mood.timestamp,
        profilePic: friend.friendId.profileImage || '',
        user: {
          _id: friend.friendId._id,
          username: friend.friendId.username,
          profilePic: friend.friendId.profileImage || ''
        }
      }))
    );

    // Combine and sort all moods
    const allMoods = [...userMoods, ...friendMoods]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    console.log('Found moods:', allMoods.length); // Debug log
    res.json(allMoods);
  } catch (error) {
    console.error('Get moods error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});*/}

// Add DELETE mood endpoint in auth.js
router.delete('/auth/moods/:moodId', authenticateToken, async (req, res) => {
  try {
    const { moodId } = req.params;
    const userId = req.user._id;

    console.log('Delete mood request:', { moodId, userId }); // Debug log

    if (!moodId || !userId) {
      return res.status(400).json({
        message: 'Missing required parameters',
        received: { moodId, userId }
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Find the mood index
    const moodIndex = user.moods.findIndex(m => m._id.toString() === moodId);

    if (moodIndex === -1) {
      return res.status(404).json({
        message: 'Mood not found',
        moodId,
        userMoodsCount: user.moods.length
      });
    }

    // Remove the mood
    user.moods.splice(moodIndex, 1);
    await user.save();

    console.log('Mood deleted successfully:', { moodId, userId }); // Debug log

    res.status(200).json({ message: 'Mood deleted successfully' });
  } catch (error) {
    console.error('Delete mood error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ================= Call Logs Routes =================
// Save call log
router.post('/call-logs', async (req, res) => {
  try {
    const { callerId, receiverId, callType, status, duration, startTime, endTime } = req.body;

    if (!callerId || !receiverId) {
      return res.status(400).json({ message: 'Caller and receiver IDs required' });
    }

    // Fetch caller and receiver details
    const caller = await User.findById(callerId).select('username profileImage');
    const receiver = await User.findById(receiverId).select('username profileImage');

    const Call = require('../models/Call');
    const callLog = new Call({
      callerId,
      callerUsername: caller?.username || '',
      callerProfileImage: caller?.profileImage || '',
      receiverId,
      receiverUsername: receiver?.username || '',
      receiverProfileImage: receiver?.profileImage || '',
      callType: callType || 'audio',
      status: status || 'completed',
      duration: duration || 0,
      startTime: startTime || new Date(),
      endTime: endTime || new Date()
    });

    await callLog.save();
    console.log('Call log saved:', { callerId, receiverId, duration });
    res.status(201).json({ message: 'Call log saved', callLog });
  } catch (error) {
    console.error('Error saving call log:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get call logs for a user (both incoming and outgoing)
router.get('/call-logs/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const Call = require('../models/Call');

    // Fetch calls where user is either caller or receiver
    const callLogs = await Call.find({
      $or: [
        { callerId: userId },
        { receiverId: userId }
      ]
    }).sort({ timestamp: -1 }).limit(100);

    res.json(callLogs);
  } catch (error) {
    console.error('Error fetching call logs:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get call history between two users
router.get('/call-logs/:userId/:otherUserId', async (req, res) => {
  try {
    const { userId, otherUserId } = req.params;
    const Call = require('../models/Call');

    // Fetch calls between these two users (both directions)
    const callLogs = await Call.find({
      $or: [
        { callerId: userId, receiverId: otherUserId },
        { callerId: otherUserId, receiverId: userId }
      ]
    }).sort({ timestamp: -1 });

    res.json(callLogs);
  } catch (error) {
    console.error('Error fetching call history:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete all call logs for a user
router.delete('/call-logs/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const Call = require('../models/Call');

    await Call.deleteMany({
      $or: [
        { callerId: userId },
        { receiverId: userId }
      ]
    });

    res.json({ message: 'All call logs deleted successfully' });
  } catch (error) {
    console.error('Error deleting call logs:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete a single call log
router.delete('/call-logs/single/:logId', async (req, res) => {
  try {
    const { logId } = req.params;
    const Call = require('../models/Call');

    const result = await Call.findByIdAndDelete(logId);
    if (!result) {
      return res.status(404).json({ message: 'Call log not found' });
    }

    res.json({ message: 'Call log deleted successfully' });
  } catch (error) {
    console.error('Error deleting single call log:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ==========================================
// LINKED DEVICES & QR/CODE AUTHENTICATION API
// ==========================================

const QrSession = require('../models/QrSession');
const LinkedDevice = require('../models/LinkedDevice');

// 1. Web application initializes a QR login session
router.post('/link-device/init-qr', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID is required' });
    }

    // Create or update session in database atomically
    const qrSession = await QrSession.findOneAndUpdate(
      { sessionId },
      { $set: { status: 'pending', createdAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ message: 'QR session initialized successfully', sessionId: qrSession.sessionId });
  } catch (err) {
    console.error('Error initializing QR session:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 2. Mobile application requests a 5-digit linking code (auto-generated on mobile!)
router.post('/link-device/generate-code', authenticateToken, async (req, res) => {
  try {
    const code = String(Math.floor(10000 + Math.random() * 90000));
    const sessionId = `juicy-code-sess-${Date.now()}`;

    const qrSession = new QrSession({
      sessionId,
      code,
      status: 'pending',
      linkedUserId: req.user._id
    });
    await qrSession.save();

    res.status(200).json({ message: 'Code generated', code, sessionId });
  } catch (err) {
    console.error('Error generating link code:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 3. Web client submits the 5-digit code typed by the web user
router.post('/link-device/submit-code', async (req, res) => {
  try {
    const { code, sessionId, browserName, deviceName, osName, ipAddress } = req.body;
    if (!code || !sessionId) {
      return res.status(400).json({ message: 'Code and Session ID are required' });
    }

    const session = await QrSession.findOne({ code, status: 'pending' });
    if (!session) {
      return res.status(404).json({ message: 'Invalid or expired code' });
    }

    // Clear any pre-existing QR session with the same web sessionId to avoid MongoDB E11000 unique key conflict
    await QrSession.deleteMany({ sessionId });

    session.status = 'scanned';
    session.sessionId = sessionId;
    session.browserInfo = { browserName, deviceName, osName, ipAddress };
    await session.save();

    const io = req.app.get('io');
    if (io) {
      io.to(String(session.linkedUserId)).emit('code_submitted', {
        sessionId,
        browserInfo: session.browserInfo
      });
      console.log(`📡 Dispatched code_submitted to mobile user room ${session.linkedUserId}`);
    }

    res.status(200).json({ message: 'Code submitted. Awaiting phone confirmation.' });
  } catch (err) {
    console.error('Error submitting code:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 4. Mobile app confirms or rejects linking (called for BOTH QR and 5-digit code)
router.post('/link-device/confirm', authenticateToken, async (req, res) => {
  try {
    const { sessionId, confirm, browserName, deviceName, osName, ipAddress } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: 'Session ID is required' });
    }

    const session = await QrSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ message: 'Linking session not found or expired' });
    }

    const io = req.app.get('io');

    if (!confirm) {
      session.status = 'pending';
      await session.save();

      if (io) {
        io.to(sessionId).emit('link_rejected', { message: 'Link request was rejected by phone.' });
      }
      return res.status(200).json({ message: 'Link request rejected' });
    }

    const webToken = jwt.sign(
      { id: req.user._id, email: req.user.email },
      process.env.JWT_SECRET || 'juicy_jwt_secret_key_2026_default',
      { expiresIn: '30d' }
    );

    const finalBrowser = browserName || (session.browserInfo && session.browserInfo.browserName) || 'Web Browser';
    const finalDevice = deviceName || (session.browserInfo && session.browserInfo.deviceName) || 'PC';
    const finalOS = osName || (session.browserInfo && session.browserInfo.osName) || 'OS';
    const finalIP = ipAddress || (session.browserInfo && session.browserInfo.ipAddress) || 'Unknown';

    const linkedDevice = new LinkedDevice({
      userId: req.user._id,
      browserName: finalBrowser,
      deviceName: finalDevice,
      osName: finalOS,
      ipAddress: finalIP,
      token: webToken
    });
    await linkedDevice.save();

    session.status = 'linked';
    session.linkedUserId = req.user._id;
    session.linkedUserToken = webToken;
    await session.save();

    if (io) {
      io.to(sessionId).emit('qr_linked', {
        userId: req.user._id,
        token: webToken,
        username: req.user.username,
        profileImage: req.user.profileImage
      });
      console.log(`📡 Broadcasted successful link to room ${sessionId}`);
    }

    res.status(200).json({ message: 'Device linked successfully', device: linkedDevice });
  } catch (err) {
    console.error('Error confirming link:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 5. Get all linked devices for authenticated user
router.get('/linked-devices', authenticateToken, async (req, res) => {
  try {
    const devices = await LinkedDevice.find({ userId: req.user._id }).sort({ lastActive: -1 });
    res.status(200).json(devices);
  } catch (err) {
    console.error('Error fetching linked devices:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// 6. Delete/Unlink a device remotely
router.delete('/linked-devices/:id', authenticateToken, async (req, res) => {
  try {
    const device = await LinkedDevice.findOne({ _id: req.params.id, userId: req.user._id });
    if (!device) {
      return res.status(404).json({ message: 'Linked device not found' });
    }

    const unlinkedToken = device.token;
    await LinkedDevice.findByIdAndDelete(device._id);

    // Emit remote logout command via socket
    const io = req.app.get('io');
    if (io) {
      io.emit('logout_device', { token: unlinkedToken });
      console.log(`📡 Dispatched remote logout for linked session`);
    }

    res.status(200).json({ message: 'Device unlinked successfully' });
  } catch (err) {
    console.error('Error unlinking device:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;