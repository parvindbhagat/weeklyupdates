const mongoose = require('mongoose');
require('dotenv').config(); // Load environment variables from .env file
const {task, taskArchive } = require('../model/task'); // Import the taskArchive model
const Counter = require('../model/counter'); // Import the Counter model
const work = require('../model/work'); // Import the work model
const resourceModel = require('../model/resource'); // Import the resource model

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

async function processUserComments() {
    try {
      //check if work collection is empty
      const workCount = await work.countDocuments();
      if (workCount > 0){
        return;
      }
      // Fetch all tasks from tasks and taskarchives collections
      const tasks = await task.find({});
      const archivedTasks = await taskArchive.find({});
      const allresources = await resourceModel.find({});
  
      // Combine tasks and archived tasks into a single array
      const allTasks = [...tasks, ...archivedTasks];
  
      for (const task of allTasks) {
        const { taskId, taskName, interventionName, clientName, resourceName, taskWork, actualWork, start, Finish, actualStart, actualFinish, userComment, leapComplete, approvalStatus, consultingDay } = task;
        
        async function getResourceFuntion(resourceName) {
          const resource = allresources.find((res) => res.resourceName === resourceName);
          return resource ? resource.resourceFunction : "Unknown";
        }

        // Skip if userComment is empty or undefined
        if (!userComment) continue;
  
        // Parse userComment for date and work hour patterns
        const commentPattern = /\((\d{1,2}\/\d{1,2}\/\d{4}):\s*([\d.]+)\s*Hrs\)/g;
        const workBreakdown = {};
  
        let match;
        while ((match = commentPattern.exec(userComment)) !== null) {
          const date = match[1]; // Extracted date (dd/mm/yyyy)
          const workHours = parseFloat(match[2]); // Extracted work hours
  
          // Aggregate work hours for the same date
          if (workBreakdown[date]) {
            workBreakdown[date] += workHours;
          } else {
            workBreakdown[date] = workHours;
          }
        }
  
        // Convert workBreakdown object to an array of key-value pairs
        const workBreakdownArray = Object.entries(workBreakdown).map(([date, work]) => ({
          date: new Date(date.split("/").reverse().join("-")), // Convert dd/mm/yyyy to Date object
          work,
        }));
  
        // Save the work breakdown in the Work schema
        const workEntry = new work({
          taskId,
          taskName,
          interventionName,
          clientName,
          taskWork,
          actualWork,
          start,
          finish: Finish,
          actualStart,  
          actualFinish,
          consultingDay,
          approvalStatus,
          leapComplete,
          resourceName,
          resourceFunction: await getResourceFuntion(task.resourceName),
          workBreakdown: workBreakdownArray,
        });
  
        try {
          await workEntry.save();
          console.log(`Work entry saved for taskId: ${taskId}`);
        } catch (error) {
          console.error(`Error saving work entry for taskId: ${taskId}`, error);
        }
      }
  
      console.log("Processing completed for all tasks.");
    } catch (error) {
      console.error("Error processing user comments:", error);
    }
  }
  
module.exports = {assignTaskIdsToTaskArchive, assignTaskIdsToTasks, processUserComments}; // Export the function for external use
