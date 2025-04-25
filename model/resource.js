const mongoose = require("mongoose");

const resourceSchema = new mongoose.Schema({
    resourceName: {type: String, required: true },
    resourceRole: {type: String, required: true },
    resourceId: { type: String, required: true },
    resourceEmail: { type: String },
    resourceGroup: { type: String },  //department name
    resourceManagerId: { type: String,    required: true,  },
    resourceManagerName: { type: String },
    managerComment: {type: String},
    resourceFunction: { type: String },  //team name
  });
  const resource = mongoose.model("resource", resourceSchema);
  module.exports = resource;