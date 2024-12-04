const mongoose = require('mongoose');


const taskSchema = new mongoose.Schema({
    projectId: {type: String, },
    projectName: {type: String,  },
    taskId: {    type: String,     },  
    taskName: {    type: String,  },
    parentTaskName: {    type: String, default: "Internal Work" },  
    taskCompletePercent: {type: Number, default: 0  },
    leapComplete: {type: Number, default: 0 },
    taskWork: {    type: Number, default: 0  },    
    taskIsActive: { type: Boolean, default: true},
    start: {    type: String, },
    Finish: {    type: String,},
    typeofActivity: {   type: String, default: "Chrysalis Work" },
    LeapSync: {    type: String, },  
    resourceId: { type: String },
    resourceName: { type: String },
    clientName: { type: String, default: "Chrysalis" },
    interventionName: { type: String, default: "Chrysalis Intervention" },
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