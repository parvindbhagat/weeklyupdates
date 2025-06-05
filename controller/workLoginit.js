const mongoose = require('mongoose');
const task = require('../model/task');         // Adjust path as needed
const Work = require('../model/work');         // Adjust path as needed
const WorkLog = require('../model/workLog');     // Adjust path as needed
const Resource = require('../model/resource');   // Assuming you have a resource model

// Make sure to use your actual connection settings
mongoose.connect('mongodb://127.0.0.1:27017/weeklyupdatesDB').then(async () => {
  console.log('Connected to MongoDB, starting migration...');
  
  try {
    // Get all work documents
  const works = await Work.find({});

for (const work of works) {
   
  // Loop over each entry in workBreakdown and create a new workLog document
  for (const breakdown of work.workBreakdown) {
    const workLogData = {
      taskId: work.taskId, // Save the custom task id as is
      resourceName: work.resourceName,
      date: breakdown.date,
      work: breakdown.work,
    };
    await WorkLog.create(workLogData);
  }
}

console.log('Migration complete.');
  } catch (err) {
    console.error('Error during migration:', err);
  } finally {
    mongoose.connection.close();
  }
}).catch(err => {
  console.error('Error connecting to MongoDB:', err);
});