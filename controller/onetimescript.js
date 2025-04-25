const mongoose = require('mongoose');
require('dotenv').config(); // Load environment variables from .env file
const {task, taskArchive } = require('../model/task'); // Import the taskArchive model
const Counter = require('../model/couter'); // Import the Counter model

async function assignTaskIdsToTaskArchive() {
  try {
    // Find all tasks in taskArchive with source: "MTE" and no taskId
    const archiveTasks = await taskArchive.find({ source: "MTE", taskId: { $exists: false } });

    if (archiveTasks.length === 0) {
      console.log("No tasks in taskArchive with source 'MTE' and missing taskId found.");
      return;
    }

    console.log(`Found ${archiveTasks.length} tasks in taskArchive with source 'MTE' and no taskId.`);

    for (const archiveTask of archiveTasks) {
      // Get the next taskId from the counter
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'taskId' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );

      // Assign the incremented taskId
      archiveTask.taskId = `MTE-${counter.seq}`;
      await archiveTask.save();
    }

    console.log("Task IDs assigned successfully to all MTE tasks in taskArchive.");
  } catch (error) {
    console.error("Error assigning task IDs to taskArchive:", error);
  }
}

async function assignTaskIdsToTasks() {
  
    try {
      // Find all tasks in tasks with source: "MTE" and no taskId
      const tasks = await task.find({ source: "MTE", taskId: { $exists: false } });
  
      if (tasks.length === 0) {
        console.log("No tasks in tasks collection with source 'MTE' and missing taskId found.");
        return;
      }
  
      console.log(`Found ${tasks.length} tasks in tasks collection with source 'MTE' and no taskId.`);
  
      for (const taskItem of tasks) {
        // Get the next taskId from the counter
        const counter = await Counter.findByIdAndUpdate(
          { _id: 'taskId' },
          { $inc: { seq: 1 } },
          { new: true, upsert: true}
        );
  
        // Assign the incremented taskId
        taskItem.taskId = `MTE-${counter.seq}`;
        await taskItem.save();
      }
  
      console.log("Task IDs assigned successfully to all MTE tasks in tasks collection.");
    } catch (error) {
      console.error("Error assigning task IDs to tasks collection:", error);
    } 
  }

module.exports = {assignTaskIdsToTaskArchive, assignTaskIdsToTasks}; // Export the function for external use
