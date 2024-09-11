const mongoose = require("mongoose");
require("dotenv").config();



const escalationSchema = new mongoose.Schema({
    clientName: {type: String, required: true },
    taskName: {    type: String,    required: true,  },
    level: {    type: String,    required: true,    enum: ["0-3", "4-10", "> 10"],  },
    remarks: {    type: String,},
    resource: {    type: String,    required: true,  },
    weekNumber: { type: Number },
    year: { type: Number },
    status: {    type: String,    required: true,    enum: ["In Progress", "Resolved", "On Going", "Not Started", "Cancelled", "On Hold"],  },
    createdOn: { type: Date, default: Date.now },
    updatedOn: { type: Date, default: Date.now } 
  });
  
  const escalation = mongoose.model("escalation", escalationSchema);
  module.exports = escalation;