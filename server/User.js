const mongoose = require('mongoose');

const VisitModelSchema = new mongoose.Schema({
  ip:{
    type: String,
    required: true
  },
  // useragent:{
  //   type: String,
  //   required: true
  // },
  route:{
    type: String,
    required: true
  },
  referer:{
    type: String,
    required: false
  },
  dateTime:{
    type: Date,
    default: Date.now
  }
});

const UserModelSchema = new mongoose.Schema({
  uid: {
    type: String,
    required: true,
    unique: true
  },
  recentIp:{
    type: String,
    required: false
  },
  uniqueIps:{
    type: [String],
    default: []
  },
  usernames:{
    type: Array,
    default: []
  },
  visits: {
    type: Object,
    default: {}
  },
  dateCreated: {
    type: String,
    default: function(){
      return new Date(new Date().getTime() + (new Date().getTimezoneOffset() + 330)*60000).toString();
    }
  }
});

UserModelSchema.index({ uniqueIps: 1 });

const PlayerProfileSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  points: {
    type: Number,
    default: 0
  },
  goals: {
    type: Number,
    default: 0
  },
  wins: {
    type: Number,
    default: 0
  },
  matches: {
    type: Number,
    default: 0
  },
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

const QueueEntrySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  position: {
    type: Number,
    default: 0
  },
  online: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

const UserModel = mongoose.model('User', UserModelSchema);
const VisitModel = mongoose.model('Visit',VisitModelSchema);
const PlayerProfileModel = mongoose.model('PlayerProfile', PlayerProfileSchema);
const QueueEntryModel = mongoose.model('QueueEntry', QueueEntrySchema);
module.exports.UserModel = UserModel;
module.exports.VisitModel = VisitModel;
module.exports.PlayerProfileModel = PlayerProfileModel;
module.exports.QueueEntryModel = QueueEntryModel;
