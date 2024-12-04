const mongoose = require('mongoose');
require('dotenv').config();

// mongoose.connect('mongodb://root:password3479@mongo:27017/task_data?authSource=admin', {}).then(() => {
mongoose.connect(process.env.MONGO_URI, {}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('Error connecting to MongoDB', err);
});



const activitySchema = new mongoose.Schema({
  activityType: { type: String, required: true },        // Activity Category for users
  activityName: { type: String, required: true },
  startDate: { type: String },
  endDate: { type: String },
  startTime: { type: String,  default: '09:00'},
  endTime: {type: String,  default: '17:00'},
  startDateTime: {type: String},
  endDateTime: {type: String},
  activityMode: { type: String, default: 'NA'},                        // Activiity Type for users
  resource: { type: String, required: true },
  remarks: { type: String, default: 'NA' },
  weekNumber: { type: Number },
  year: { type: Number },
  status: { type: String,  default: "On Going", enum: ["Completed", "On Going", "Not Started", "Cancelled", "On Hold"],  },
  createdOn: { type: Date, default: Date.now },
  updatedOn: { type: Date, default: Date.now }
});


const activity = mongoose.model('activity', activitySchema);

module.exports = activity;