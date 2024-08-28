const mongoose = require('mongoose');
require('dotenv').config();


mongoose.connect(process.env.MONGO_URI, {}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('Error connecting to MongoDB', err);
});



const activitySchema = new mongoose.Schema({
  activityType: { type: String, required: true },        // Activity Category for users
  activityName: { type: String, required: true },
  startDate: { type: String,  default: 'NA'  },
  endDate: { type: String,  default: 'NA'  },
  activityMode: { type: String, default: 'NA'},                        // Activiity Type for users
  resource: { type: String, required: true },
  remarks: { type: String, default: 'NA' },
  weekNumber: { type: Number },
  status: { type: Boolean, default: false },
  createdOn: { type: Date, default: Date.now },
  updatedOn: { type: Date, default: Date.now }
});


const activity = mongoose.model('activity', activitySchema);

module.exports = activity;
