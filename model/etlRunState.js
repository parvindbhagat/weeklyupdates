const mongoose = require('mongoose');

// Single-document collection — always upserted, never grows.
// Use etlRunStateModel.findOneAndUpdate({ _id: SINGLETON_ID }, ..., { upsert: true })
const etlRunStateSchema = new mongoose.Schema({
  _id: { type: String, default: 'zohoEtlState' },
  lastSuccessfulRun: { type: Date, default: null },  // null = never run
  lastAttemptedAt:   { type: Date, default: null },
  lastRunBy:         { type: String, default: null },  //store the userName of the user who triggered the run
  recordsInserted:   { type: Number, default: 0 },
  failedRecords:    { type: Number, default: 0 },    // for partial success tracking
  lastStatus:        { type: String, enum: ['Success', 'PartialSuccess', 'Error', null], default: null }
});

const etlRunStateModel = mongoose.model('etlRunState', etlRunStateSchema);
module.exports = etlRunStateModel;
