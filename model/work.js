const mongoose = require('mongoose');

const workSchema = new mongoose.Schema({
  taskId: { type: String, required: true }, // Reference to the task
  taskName: { type: String, required: true },
  consultingDay: { type: String },
  interventionName: { type: String, required: true },
  clientName: { type: String },
  resourceName: { type: String, required: true },
  resourceFunction: { type: String, default: "Unknown" },
  start: { type: Date },
  finish: { type: Date },
  actualStart: { type: Date },
  actualFinish: { type: Date },
  taskWork: { type: Number, default: 0 }, // Planned work
  actualWork: { type: Number, default: 0 }, // Sum of all work hours in workBreakdown
  leapComplete: { type: Number, default: 0 },
  approvalStatus: { type: String },
  workBreakdown: [
    {
      date: { type: Date, required: true },
      work: { type: Number, required: true },
    },
  ],
});

const Work = mongoose.model("Work", workSchema);

module.exports = Work;