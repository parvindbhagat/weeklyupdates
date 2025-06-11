const mongoose = require('mongoose');


const taskSchema = new mongoose.Schema({
    projectId: {type: String, default: "chrd001" },
    projectName: {type: String,  },
    ProjectStatus: {type: String, },
    ProjectPercentWorkCompleted: {type: Number, default: 0 },
    taskId: {    type: String,     },  
    taskName: {    type: String,  },
    parentTaskName: {    type: String, default: "Internal Work" },  
    taskCompletePercent: {type: Number, default: 0  },
    leapComplete: {type: Number, default: 0 },
    taskWork: {    type: Number, default: 0  },    
    taskIsActive: { type: Boolean, default: true},
    start: {    type: Date, },
    Finish: {    type: Date,},
    typeofActivity: {   type: String, default: "Chrysalis Work" },
    LeapSync: {    type: String, },  
    resourceId: { type: String },
    resourceName: { type: String },
    clientName: { type: String, default: "Chrysalis" },
    interventionName: { type: String, default: "Chrysalis Intervention" },
    actualStart: { type: Date },
    actualFinish: { type: Date },
    actualWork: { type: Number, default: 0 },
    userComment: {type: String },
    approvalStatus: {type: String, default: "Pending" },
    source:{type: String, default: "PWA"},
    saved: {type: Number, default: 0 },
    submitted: {type: Number, default: 0},
    consultingDay: {type: String, default: "NA"},
    taskIndex: {type: Number, default: 0},
    delayStatus: {type: String, default: "NA"},
    updatedOn: { type: Date, default: Date.now },
    updatedBy: { type: String, default: "System" },
  });
  const task = mongoose.model("task", taskSchema);
  const taskArchive = mongoose.model('taskArchive', taskSchema); // Reuse the same schema for the archive collection

  module.exports = {task, taskArchive};
  // module.exports = task; // Export the task model only, as the archive model is not needed in this file