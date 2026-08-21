const mongoose = require('mongoose');

const QrSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true }, // Socket room ID
  code: { type: String }, // 5-digit code for numeric link option
  status: { type: String, enum: ['pending', 'scanned', 'linked', 'expired'], default: 'pending' },
  linkedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  linkedUserToken: { type: String }, // Token sent to web client
  browserInfo: {
    browserName: String,
    deviceName: String,
    osName: String,
    ipAddress: String
  },
  createdAt: { type: Date, default: Date.now, expires: 120 } // auto expire after 120s (2m)
});

module.exports = mongoose.model('QrSession', QrSessionSchema);
