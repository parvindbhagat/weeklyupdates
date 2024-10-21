const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema({
    projectName: {type: String, required: true },
    taskName: {    type: String,    required: true },
    projectId: {type: String, required: true },
    taskId: {    type: String,    required: true },    
    start: {    type: String, },
    Finish: {    type: String,},
    resource: { type: String },
    activityType: {    type: String, },
    remarks: {type: String },
    status: {type: String }
  });
  const task = mongoose.model("task", taskSchema);
  module.exports = task;