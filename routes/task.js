const mongoose = require('mongoose');


const taskSchema = new mongoose.Schema({
    projectId: {type: String, },
    projectName: {type: String,  },
    taskId: {    type: String,     },  
    taskName: {    type: String,  },
    parentTaskName: {    type: String, },  
    taskCompletePercent: {type: Number,  },
    taskWork: {    type: Number,  },    
    taskIsActive: { type: Boolean},
    start: {    type: String, },
    Finish: {    type: String,},
    typeofActivity: {   type: String, },
    LeapSync: {    type: String, },  
    resourceId: { type: String },
    resourceName: { type: String },
    clientName: { type: String },
    interventionName: { type: String },
    actualStart: { type: String },
    actualFinish: { type: String },
    actualWork: { type: Number, default: 0 },
    userComment: {type: String },
    approvalStatus: {type: String, default: "Pending" },
    source:{type: String, default: "PWA"},
    saved: {type: Number, default: 0 },
    submitted: {type: Number, default: 0}
  });
  const task = mongoose.model("task", taskSchema);
  module.exports = task;