const mongoose = require('mongoose');


const taskSchema = new mongoose.Schema({
    projectId: {type: String, },
    projectName: {type: String,  },
    taskId: {    type: String,     },  
    taskName: {    type: String,  },
    parentTaskName: {    type: String, },  
    taskCompletePercent: {type: String,  },
    taskWork: {    type: Number,  },    
    start: {    type: String, },
    Finish: {    type: String,},
    resourceId: { type: String },
    resourceName: { type: String },
    activityType: {   type: String, },
    LeapSync: {    type: String, },  
    clientName: { type: String },
    interventionName: { type: String },
    actualStart: { type: String },
    actualFinish: { type: String },
    actualWork: { type: String },
    userComment: {type: String },
    approvalStatus: {type: String },
    source:{type: String},
  });
  const task = mongoose.model("task", taskSchema);
  module.exports = task;