// filepath: /model/workLog.js
const mongoose = require('mongoose');

const workLogSchema = new mongoose.Schema({
  taskId: { type: String, ref: 'task', required: true },
  resourceName: { type: String, ref: 'resource', required: true },
  date: { type: Date, required: true },
  work: { type: Number, required: true },
});

const WorkLog = mongoose.model('WorkLog', workLogSchema);
module.exports = WorkLog;