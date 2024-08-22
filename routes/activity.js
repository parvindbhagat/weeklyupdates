const mongoose = require('mongoose');
require('dotenv').config();


mongoose.connect(process.env.MONGO_URI, {}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('Error connecting to MongoDB', err);
});



const activitySchema = new mongoose.Schema({
  activityType: { type: String, required: true },
  activityName: { type: String, required: true },
  startDate: { type: String,  default: 'NA'  },
  endDate: { type: String,  default: 'NA'  },
  resource: { type: String, required: true },
  remarks: { type: String },
  weekNumber: { type: Number },
  status: { type: Boolean, required: true, default: false },
  createdOn: { type: Date, default: Date.now },
  updatedOn: { type: Date, default: Date.now }
});


const activity = mongoose.model('activity', activitySchema);

module.exports = activity;
