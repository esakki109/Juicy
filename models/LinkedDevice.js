const mongoose = require('mongoose');

const LinkedDeviceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  browserName: { type: String, default: 'Browser' },
  deviceName: { type: String, default: 'Desktop' },
  osName: { type: String, default: 'OS' },
  ipAddress: { type: String, default: 'Unknown' },
  token: { type: String, required: true }, // The JWT token generated for this linked session
  socketId: { type: String }, // To track active socket connections for remote disconnect
  lastActive: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('LinkedDevice', LinkedDeviceSchema);
