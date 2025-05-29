var express = require("express");
var router = express.Router();
const session = require("express-session");
const {task: taskModel, taskArchive: taskArchiveModel }= require("../model/task");
const resourceModel = require("../model/resource");
const workModel = require("../model/work");
require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");
const {getAccessToken, cca: msal } = require("../authconfig");
const qs = require("qs");
const moment = require("moment");
const initializeResources = require("../controller/resourcecontrol");
const {assignTaskIdsToTaskArchive, assignTaskIdsToTasks, processUserComments} = require("../controller/onetimescript");
const Counter = require("../model/couter");


// function to check user is logged in with MSAL Auth flow
function isAuthenticated(req, res, next) {
  // console.log("isAuthenticated function called");
  if (req.session.user) {
    // console.log('Session data:', req.session);
    // console.log('isAuthenticated-if user: Session user data:', req.session.user);
    console.log("isAuth: User is logged in, calling next use is: ", req.session.user.name);
    return next();
  } else {
    req.session.originalUrl = req.originalUrl; // Store the original URL.
    // console.log('isAuthenticated-else: session user data is :', req.session.user);
    // console.log("User Not logged in, stored url and redirecting to /login, stored url is: ", req.session.originalUrl );
    res.redirect("/login");
  }
}

//function to check if the user session is active with session data if yes, go next else go to /?sessionExpired
function isSessionActive(req, res, next) {
  // console.log("isSessionActive function called");
  if (req.session && req.session.user) {
    // console.log("isSessionActive: User is logged in, calling next use is: ", req.session.user.name);
    return next();
  } else {
    // console.log("isSessionActive: User Not logged in, redirecting to /?msg=sessionExpired");
    res.redirect("/?msg=sessionExpired");
  }
}

async function isAdmin(req, res, next) {
  if (req.session && req.session.user) {
    // console.log("User is logged in, checking user Role in resource model.");
    const user = req.session.user;
    const resource = await resourceModel.findOne({resourceName: user.name});
    if(!resource){
      // console.log("user not found in db. sending to /profile");
      res.redirect('/profile');
    } else{
      if(resource.resourceRole === "Admin"){
        return next();
      }else {
        res.redirect('/profile');
      }
    }
  
  } else {
    req.session.originalUrl = req.originalUrl; // Store the original URL
    // console.log(
    //   "User Not logged in, stored url and redirecting to /login, stored usl is: ",
    //   req.session.originalUrl
    // );
    res.redirect("/login");
  }
}

//function to check if user is a MANAGER also allow Admin role to go to this page
async function isManager(req, res, next) {
  if (req.session && req.session.user) {
    // console.log("User is logged in, checking user Role in resource model.");
    const user = req.session.user;
    // console.log("isManager: User details are:", user);
    const resource = await resourceModel.findOne({resourceName: user.name});
    if(!resource){
      // console.log("user not found in db. sending to /profile");
      res.redirect('/profile');
    } else{
      if(resource.resourceRole === "Manager" || resource.resourceRole === "Admin"){
        console.log("logged in user Role is Manager/Admin and user Name is: ", user.name);
        return next();
      }else {
        res.redirect('/profile');
      }
    }
  
  } else {
    req.session.originalUrl = req.originalUrl; // Store the original URL
    // console.log(
    //   "User Not logged in, stored url and redirecting to /login, stored usl is: ",
    //   req.session.originalUrl
    // );
    res.redirect("/login");
  }
}

// middleware to check if the user is logged in and a leader
async function isLeadership(req, res, next) {
  const leaders = process.env.PM_LEADERSHIP.split(",").map(name => name.trim());
  // console.log("leaders are: ", leaders);
  if(req.session && req.session.user) {
  const user = req.session.user;
  const resource = await resourceModel.findOne({resourceName: user.name});
  if(!resource){
    // console.log("user not found in db. sending to root");
    res.redirect('/');
  } else{
    if (leaders.includes(resource.resourceName)) {
      // console.log("logged in user is a leader and user Name is: ", user.name);
      return next();
    } else {
      console.log("logged in user is not a leader and user Name is: ", user.name);
      res.redirect("/profile");
    }
  } 
} else {
  req.session.originalUrl = req.originalUrl; // Store the original URL
  res.redirect("/login");
}
}

//function to check if user is a MEMBER of the FTE or PTE group and redirect to the correct page
async function redirectBasedOnGroup(req, res, next) {
  console.log("redirectBasedOnGroup function called");
    const user = req.session.user;
    // console.log('user data  is: ', { user });
    const userId = user.localAccountId;
    const FTEGroupID = process.env.FTE_ID;
    const PTEGroupID = process.env.PTE_ID;

    try {
        const accessToken = await getAccessToken();
        req.session.gToken = accessToken;
        // console.log({ accessToken });

        const fteUrl = `https://graph.microsoft.com/v1.0/users/${userId}/memberOf?$filter=id eq '${FTEGroupID}'`;
        const pteUrl = `https://graph.microsoft.com/v1.0/users/${userId}/memberOf?$filter=id eq '${PTEGroupID}'`;

        const [fteResponse, pteResponse] = await Promise.all([
            fetch(fteUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }),
            fetch(pteUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            })
        ]);

        // if (!fteResponse.ok || !pteResponse.ok) {
        //     throw new Error(`HTTP error! status: ${fteResponse.status} or ${pteResponse.status}`);
        // }

        const fteData = await fteResponse.json();
        const pteData = await pteResponse.json();

        // Check if the user is a member of either group
        const isFTE = fteData.value && fteData.value.length > 0;
        const isPTE = pteData.value && pteData.value.length > 0;

        if (isFTE) {
            return next();
        } else if (isPTE) {
            res.redirect(process.env.PTE_URL);
        } else {
            res.status(403).send('User is not a member of the Chrysalis group');
        }
    } catch (error) {
        console.error('Error checking group membership:', error);
        res.status(500).send('Internal Server Error');
    }
}

//is member of the PTE group .
async function isFTE(req, res, next) {
  console.log("isFTE function called");
    const user = req.session.user;
    let accessToken;
    // console.log('isFTE got user from session', {user});
    const userId = user.localAccountId;
    const groupId = process.env.FTE_ID; //process.env.PTE_ID; depends on group id to be checked
    // const url = `https://graph.microsoft.com/v1.0/me/memberOf?$filter=id eq '${groupId}'`;
    const url = `https://graph.microsoft.com/v1.0/users/${userId}/memberOf?$filter=id eq '${groupId}'`;

    try {
      if (req.session.gToken) {
        accessToken = req.session.gToken;
      } else {
        accessToken = await getAccessToken();
        // console.log({ accessToken });
      }
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        // console.log({ response });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Check if the user is a member of the group
        const isMember = data.value && data.value.length > 0;

        if (isMember) {
            return next();
        } else {
            res.status(403).send(`You are not a member of the valid group. Please visit the correct link: ${process.env.PTE_URL}`);
        }
    } catch (error) {
        console.error('Error checking group membership:', error);
        res.status(500).send(`Failed to verify group membership.  You can log in then try again. If you are a member of X team, please visit :  ${process.env.PTE_URL}`);
    }
}

const checkPendingSubmissions = async (loggedInUserName) => {
  try {
    // Step 1: Find the logged-in user's resource details
    const manager = await resourceModel.findOne({ resourceName: loggedInUserName });
    if (!manager) {
      console.log("User not found in resourceModel.");
      return "No"; // No tasks to notify
    }

    // Step 2: Check if the user is a Member
    if (manager.resourceRole === "Member") {
      console.log("User is a Member. No tasks to notify.");
      return "No"; // No tasks to notify
    }

    // Step 3: Find all resources managed by the logged-in user
    const managedResources = await resourceModel.find({ resourceManagerId: manager.resourceId });
    const managedResourceIds = managedResources.map(resource => resource.resourceId);

    if (managedResourceIds.length === 0) {
      console.log("No resources managed by the user.");
      return "No"; // No tasks to notify
    }

    // Step 4: Query the taskModel for tasks that meet the conditions
    const pendingTasksCount = await taskModel.countDocuments({
      submitted: 1,
      approvalStatus: "Submitted. Awaiting Approval",
      consultingDay: { $ne: "No" }, // Exclude tasks with consultingDay as "No" ie tasks that are CD: yes or MTE with CD: NA
      resourceId: { $in: managedResourceIds }, // Check if the task's resourceId is in the list of managed resources
    });

    // Return "Yes" if tasks exist, otherwise "No"
    return pendingTasksCount > 0 ? "Yes" : "No";
  } catch (error) {
    console.error("Error checking pending submissions:", error);
    return "No"; // Default to "No" in case of an error
  }
};

function sanitizeUserComment(userComment) {
  if (typeof userComment !== 'string') {
    return userComment; // Return as is if it's not a string
  }
  return userComment.replace(/;/g, ','); // Replace all ";" with ","
}

// Function to update or add work breakdown entry in work collection
async function updateWorkBreakdown(taskId, actualWork) {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize the date to remove time

  // Find the task details from the taskModel
  const task = await taskModel.findOne({ taskId });
  if (!task) {
    console.error(`Task with taskId ${taskId} not found.`);
    return;
  }

  const existingWork = await workModel.findOne({ taskId });
  if (existingWork) {
    // Check if today's date already exists in the workBreakdown
    const existingEntry = existingWork.workBreakdown.find(
      (entry) => entry.date.getTime() === today.getTime()
    );

    if (existingEntry) {
      // If the date exists, add the work hours to the existing entry
      existingEntry.work += parseFloat(actualWork);
    } else {
      // If the date doesn't exist, add a new entry
      existingWork.workBreakdown.push({
        date: today,
        work: parseFloat(actualWork),
      });
    }

    // Update the total actualWork
    existingWork.actualWork = existingWork.workBreakdown.reduce(
      (sum, entry) => sum + entry.work,
      0
    );

    await existingWork.save();
  } else {
    // If no work document exists, create a new one with all required fields
    const newWork = new workModel({
      taskId: task.taskId,
      taskName: task.taskName,
      consultingDay: task.consultingDay || "Unknown",
      interventionName: task.interventionName || "Unknown",
      clientName: task.clientName || "Unknown",
      resourceName: task.resourceName || "Unknown",
      resourceFunction: task.resourceFunction || "Unknown",
      start: task.start || null,
      finish: task.Finish || null,
      actualStart: task.actualStart || null,
      actualFinish: task.actualFinish || null,
      taskWork: task.taskWork || 0, // Planned work
      actualWork: task.actualWork, // Total work hours
      leapComplete: task.leapComplete || 0,
      approvalStatus: task.approvalStatus || "Pending",
      workBreakdown: [
        {
          date: today,
          work: parseFloat(actualWork),
        },
      ],
    });

    await newWork.save();
  }
}

//function to check if the tasks delay status if its NA them its not delayed otherwise it is delayed. then add isDelayed key value to each task as per its delay status.
function isDelayed(activity) {
  if (activity.delayStatus === "NA") {
    return false; // Not delayed if delayStatus is "NA"
  } else {
    return true; // Delayed if delayStatus is anything else
  }
}

//GET APP HOME
router.get("/", async (req, res) => {  
    let msg = req.query.msg || ""; // Get the message from the query string 
    let msg_debug;
    if (msg === "sessionExpired") {
      msg = "Session expired. Please login again.";
    }
    if (process.env.NODE_ENV === "development") {
      msg_debug = "This is Development Environment. Please use the LIVE app at:";
    }
  res.render("index", { msg, msg_debug });
});

router.get("/leap", isAuthenticated, isFTE, async (req, res) => {
  let isLeader;
  const leaders = process.env.PM_LEADERSHIP.split(",").map(name => name.trim());
  const user = req.session.user;
  //check if the resourceDetails.resourceName exist in leaders array
  if (!user) {
    console.log("Resource details not found, redirecting to root.");
    return res.redirect("/?msg=sessionExpired"); // Redirect to home with session expired message
  } else if (leaders.includes(user.name)) {
    console.log("User is a leader");
    isLeader = true; // Set isLeader to true if user is a leader
  } else {
    console.log("User is not a leader");
    isLeader = false; // Set isLeader to false if user is not a leader
  }
  console.log("isLeader value is: ", isLeader);
  // if (resourceDetails.resourceRole === "Admin") {
  //   // console.log("Admin user logged in, calling processUserComments function.");
  //   await processUserComments(); // Process user comments if needed
  // }  // comment to avoid running it more than once.
  let msg = "";
res.render("leap", { msg, isLeader  }); // Render the leap page with the resource details and isLeader status
});

router.get("/home", isAuthenticated, redirectBasedOnGroup, async (req, res) => {  
  const accessToken = req.session.token;
  const user = req.session.user;
  const resourceName = user.name;
  const resource = await resourceModel.findOne({ resourceName: resourceName }, { resourceRole: 1 }).lean();
  const resourceRole = resource ? resource.resourceRole : null;
  // console.log(`User role is: ${resourceRole}`);
  // await assignTaskIdsToTaskArchive(); // Assign task IDs to taskArchive collection
  // await assignTaskIdsToTasks(); // Assign task IDs to tasks collection
  if (resourceRole === "Admin") {
  await initializeResources(accessToken); // Initialize resources if needed
  }
  let msg = "";
res.render("home", { msg });
});

//admin page
router.get("/admin", isAdmin, async (req, res) => {
  const user = req.session.user;
  // console.log("logged in user to /admin page is: ", user.name);
  const tasks = await taskModel.find();

  // Process data to get the count of tasks per projectName and their completion status
  const taskData = tasks.reduce((acc, task) => {
    if (!acc[task.projectName]) {
      acc[task.projectName] = { count: 0, complete: 0, incomplete: 0, ProjectStatus: task.ProjectStatus };
    }
    acc[task.projectName].count += 1;
    if (task.taskCompletePercent === 100) {
      acc[task.projectName].complete += 1;
    } else {
      acc[task.projectName].incomplete += 1;
    }
    return acc;
  }, {});

  const projectNames = Object.keys(taskData);
  const taskCounts = projectNames.map(name => taskData[name].count);
  const taskCompleteCounts = projectNames.map(name => taskData[name].complete);
  const taskIncompleteCounts = projectNames.map(name => taskData[name].incomplete);
  // const ProjectStatuses = projectNames.map(name => taskData[name].ProjectStatus);
  const projectLabels = projectNames.map(name => `${name} (${taskData[name].ProjectStatus})`);

  res.render("admin", { projectLabels, taskCounts, taskCompleteCounts, taskIncompleteCounts });
});

function getWeekNumber(date) {
  const target = new Date(date.valueOf());
  const dayNumber = (date.getUTCDay() + 6) % 7; // Get day number (Monday = 0, Sunday = 6)
  target.setUTCDate(target.getUTCDate() - dayNumber + 3); // Set target to nearest Thursday
  const firstThursday = new Date(target.getUTCFullYear(), 0, 4); // Get first Thursday of the year
  const weekNumber =
    1 +
    Math.round(
      ((target - firstThursday) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return weekNumber;
}

function getCurrentWeekDateRange() {
  const today = moment();
  const startDate = today.clone().startOf('week').add(1, 'days').startOf('day'); // Adjust to Monday and normalize time
  const endDate = startDate.clone().add(5, 'days').startOf('day'); // Adjust to Saturday and normalize time
  // console.log(startDate, endDate);
  return { startDate: startDate.toDate(), endDate: endDate.toDate() };
}

function getDateRangeForMonth() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { monthStart, monthEnd };
}

// combine date and Time  to return DateTime object for mathematical operations
function convertToDateTime(dateValue, timeValue) {
  const dateTimeString =
    dateValue.split("/").reverse().join("-") + "T" + timeValue + "00:00:00";
  return new Date(dateTimeString);
}

// search records on multiple fields with partial match and case insensitive  character.
async function findRecordsByFields(searchTerm) {
  try {
    const query = {
      $or: [
        { taskName: { $regex: searchTerm, $options: "i" } },
        { interventionName: { $regex: searchTerm, $options: "i" } },
        { resourceName: { $regex: searchTerm, $options: "i" } },
        { status: { $regex: searchTerm, $options: "i" } },
        { start: { $regex: searchTerm, $options: "i" } },
        { Finish: { $regex: searchTerm, $options: "i" } },
        { userComment: { $regex: searchTerm, $options: "i" } },
      ],
    };

    const records = await taskModel.find(query);
    return records;
  } catch (error) {
    console.error("Error finding records:", error);
  }
}


///////////////////////////////////////////////////MSAL and PWA routes here ////////////////////////////////////////////////////////

//start MSAL auth process to get auth code with pwa scope /////////////////////////////////////////////////////////////////////////
router.get("/login", async (req, res) => {
  try {
    const scopes = [process.env.S_SCOPE];
    // console.log(scopes);
      const authUrl = await msal.getAuthCodeUrl({
      scopes: scopes,
      redirectUri: process.env.REDIRECT_URI,
    });
    // console.log(authUrl);

    res.redirect(authUrl);
  } catch (error) {
    console.log(error);
    res.status(500).send("Error generating auth URL");
  }
});

//use auth code to get access Token  /////////////////////////////////////////////////////////////////////////////////////////////////
router.get("/oauth/redirect", async (req, res) => {
  const tokenRequest = {
    code: req.query.code,
    scopes: [process.env.S_SCOPE],
    redirectUri: process.env.REDIRECT_URI,
  };

  try {
    const response = await msal.acquireTokenByCode(tokenRequest);
    // console.log('oauth/redirect: API response JSON is: ', JSON.stringify(response, null, 2));
    req.session.user = response.account;
    req.session.token = response.accessToken;
    // console.log('session data req.session.user after log in is: ', req.session.user);
    const redirectUrl = req.session.originalUrl || "/leap";
    delete req.session.originalUrl; // Clear the stored URL
    res.redirect(redirectUrl);
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
});

//profile page to land after access token authenticated also initialize resource MOdel if empty  /////////////////////////////////////////////////////////////////////
router.get("/profile", isAuthenticated,  async (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/home");
  }
  function encodeResourceName(name) {
    return qs.stringify({ name }).split("=")[1];
  }

  try {
  const user = req.session.user;
  const accessToken = req.session.token;
  // const accessToken = req.session.token;
  const resourceName = user.name;
  // const encodedName = encodeResourceName(resourceName);
  console.log("LOGGED IN to /profile Name is : ", resourceName);
  await initializeResources(accessToken);
  const resourceDetails = await resourceModel.findOne({
    resourceName: resourceName,
  });
  const { startDate, endDate } = getCurrentWeekDateRange();
 
  // const userTasks = await taskModel.find({resourceName: resourceName});
  const incompleteTasks = await taskModel.find({
    $and: [
        {
            $or: [
                { start: { $gte: startDate, $lte: endDate } }, // starts within current week
                { Finish: { $gte: startDate, $lte: endDate } }, // finishes within current week
                {
                    $and: [
                        { start: { $lt: startDate } },
                        { Finish: { $gt: endDate } }
                    ] // starts before current week and finishes after current week
                },
                {
                    $and: [
                        { Finish: { $lt: startDate } },
                        { taskCompletePercent: { $lt: 100 } }
                    ] // finished before current week but still incomplete
                },
                {
                    $and: [
                        { start: { $gte: startDate, $lte: endDate } },
                        { taskCompletePercent: { $eq: 100 } }
                    ] // completed tasks that started within the week
                },
                {
                    $and: [
                        { Finish: { $gte: startDate, $lte: endDate } },
                        { taskCompletePercent: { $eq: 100 } }
                    ] // completed tasks that finished within the week
                },
                {
                  $and: [
                      { Finish: { $lt: startDate } },
                      { taskCompletePercent: { $lt: 100 } },
                      { submitted: { $ne: 2 } }
                  ] // finished before current week, its completes but still not approved by manager
              }
            ]
        },
        { resourceName: resourceName },
        {ProjectStatus: { $ne: "On Hold" }},
        {approvalStatus: { $ne: "Approved" }}
      ]
  }).sort({interventionName: 1, taskIndex: 1});

  const loggedInUserName = req.session.user.name; // Get the logged-in user's name from the session
  let msg2;

  try {
   msg2 = await checkPendingSubmissions(loggedInUserName); // Wait for the function to resolve
   if (msg2 === "Yes") {
     console.log("You have pending submissions to review.");
     msg2 = "You have pending submissions by team members to review.";
   } else {
     console.log("No pending submissions.");
     msg2 = "";
   }
  } catch (error) {
   console.error("Error checking pending submissions:", error);
   msg2 = "Error checking pending submissions.";
  }

   let msg = "";
    if (req.query.msg === "successadd") {
      msg = "New task added successfully.";
    } else if (req.query.msg === "failadd") {
      msg = "Failed to add new task. Please login and try again.";
    } else if (req.query.msg === "failsave") {
      msg = "Failed to save task data. Please try again.";
    } else if (req.query.msg === "successsave") {
      msg = "Task saved successfully.";
    } else if (req.query.msg === "successupdate") {
      msg = "Task updated successfully.";
    } else if (req.query.msg === "failupdate") {
      msg = "Failed to update task data. Please try again.";
    }

   res.render('profile', {user, incompleteTasks, resourceDetails, startDate, endDate, msg, msg2});  //  Actual data to be passed to view for usrs view.
  
  } catch (error) {
    console.log(error.message);
    next(error);
  }
});

// /profile method post to SAVE Manual Task Entries.  /////////////////////////////////////////////////////////////////////////////////////////////////
router.post("/profile", isSessionActive, async (req, res) => {
  try {
    if (!req.session.user) {
      let sessions;
      return res.render("home", {
        sessions,
        msg: "You need to be logged in to add a task. Please login and try again.",
      });
    }

    const user = req.session.user;
    const resourceName = user.name;
    const resource = await resourceModel.findOne({ resourceName: resourceName });
    const resourceId = resource.resourceId;

    let {
      projectName,
      taskName,
      actualStart,
      actualFinish,
      actualWork,
      userComment,
      completed,
    } = req.body;

    userComment = sanitizeUserComment(userComment);
    const start = new Date(actualStart);
    const Finish = new Date(actualFinish);

    const source = "MTE";
    const LEAPApplicationSync = "No";
    const saved = 1;
    const approvalStatus = "Saved, Awaiting Submission";
    const clientName = "Chrysalis";
    const datedComment =
      "(" +
      new Date().toLocaleDateString("en-in") +
      ": " +
      actualWork +
      " Hrs)" +
      userComment;

    // Get the next taskId from the counter
    const counter = await Counter.findByIdAndUpdate(
      { _id: "taskId" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const taskId = `MTE-${counter.seq}`; // Generate the unique taskId

    const task = new taskModel({
      taskId: taskId, // Assign the unique taskId
      projectName: projectName,
      taskName: taskName,
      actualStart: start,
      start: start,
      actualFinish: Finish,
      Finish: Finish,
      actualWork: actualWork,
      leapComplete: completed,
      LeapSync: LEAPApplicationSync,
      source: source,
      saved: saved,
      approvalStatus: approvalStatus,
      userComment: datedComment,
      resourceName: resourceName,
      resourceId: resourceId,
      clientName: clientName,
    });

    try {
      const savedTask = await task.save();
      if (savedTask) {
        // Update or create the work breakdown
        await updateWorkBreakdown(taskId, actualWork);
        res.redirect("/profile?msg=successadd");
      } else {
        console.log("Error saving the task:", taskName);
        res.redirect("/profile?msg=failadd");
      }
    } catch (error) {
      console.log("Error saving task:", error.message);
      res.redirect("/profile?msg=failadd");
    }
  } catch (error) {
    console.log("Error in POST /profile:", error.message);
    res.redirect("/profile?msg=failadd");
  }
});



// route to show activites for users from the pwa data stored in the database. //////////////////////////////////////////////////////////////////////////////////////
router.get("/pwaactivities", isAuthenticated, isFTE, async (req, res, next) => {
  const { startDate, endDate } = getCurrentWeekDateRange();
  let { interventionName, resourceName } = req.query; // Get the selected interventionName and resourceName from the query parameters

  let activities = await taskModel.find({
    $and: [
      {
        $or: [
          { start: { $gte: startDate, $lte: endDate } }, // starts within current week
          { Finish: { $gte: startDate, $lte: endDate } }, // finishes within current week
          {
            $and: [
              { start: { $lt: startDate } },
              { Finish: { $gt: endDate } },
            ], // starts before current week and finishes after current week
          },
          {
            $and: [{ Finish: { $lt: startDate }, taskCompletePercent: { $lt: 100 } }],
          }, // Task has finish date in past week but is still incomplete
        ],
      },
      { source: "PWA" },
      { ProjectStatus: { $ne: "On Hold" } },
    ],
  }).sort({ typeofActivity: -1, interventionName: 1, taskIndex: 1 }); // returns activities with start/finish between current week or activity that either starts or finishes in current week.
  
  // identify delayed tasks if the finish is before today
  const delayedTasks = activities.filter(activity => {
    const finishDate = new Date(activity.Finish);
    return finishDate < new Date() && activity.taskCompletePercent < 100;
  });
  // Update the status of delayed tasks to delayStatus in the database set it to "Non-Excusable Delay" if its 'NA'
  if (delayedTasks.length > 0 && delayedTasks.some(task => task.delayStatus === "NA")) {
    await taskModel.updateMany(
      { _id: { $in: delayedTasks.map(task => task._id) } },
      { $set: { delayStatus: "Non-Excusable Delay" } }
    );
  }
  //check if any task has delayStatus other than NA and its taskCompletePercent is equal to 100; that is delayed task is completed now make its DelayStatus back to "NA".
  const completedDelayedTasks = activities.filter(activity => {
    const finishDate = new Date(activity.Finish);
    return finishDate < new Date() && activity.taskCompletePercent === 100 && activity.delayStatus !== "NA";
  });
  if (completedDelayedTasks.length > 0) {
    await taskModel.updateMany(
      { _id: { $in: completedDelayedTasks.map(task => task._id) } },
      { $set: { delayStatus: "NA" } }
    );
  } 

  // Add isDelayed property to each activity based on its delay status
  activities.forEach(activity => {
    activity.isDelayed = isDelayed(activity);
  });

  // Apply projectName filter if provided
  if (interventionName) {
    activities = activities.filter(activity => activity.interventionName === interventionName);
  }

  // Apply resourceName filter if provided
  if (resourceName) {
    activities = activities.filter(activity => activity.resourceName === resourceName);
  }

  // Group activities by typeofActivity
  const groupedActivities = activities.reduce((acc, activity) => {
    if (!acc[activity.typeofActivity]) {
      acc[activity.typeofActivity] = [];
    }
    acc[activity.typeofActivity].push(activity);
    return acc;
  }, {});

  // Flatten groupedActivities to extract unique project and resource names
  const flattenedActivities = Object.values(groupedActivities).flat();
  const interventionNames = [...new Set(flattenedActivities.map(activity => activity.interventionName))];
  const resourceNames = [...new Set(flattenedActivities.map(activity => activity.resourceName))];

  const projectsOnHold = await taskModel.distinct("projectName", { ProjectStatus: "On Hold" });

  const loggedInUserName = req.session.user.name; // Get the logged-in user's name from the session
  let msg;

  try {
    msg = await checkPendingSubmissions(loggedInUserName); // Wait for the function to resolve
    if (msg === "Yes") {
      console.log("You have pending submissions to review.");
      msg = "You have pending submissions by team members to review.";
    } else {
      console.log("No pending submissions.");
      msg = "";
    }
  } catch (error) {
    console.error("Error checking pending submissions:", error);
    msg = "Error checking pending submissions.";
  }

  console.log("length of activities is: ", activities.length);
  res.render("pwaactivities", {
    groupedActivities,
    interventionNames,
    resourceNames,
    selectedInterventionName: interventionName || '', // Pass the selected projectName to the view  
    selectedResourceName: resourceName || '', // Pass the selected resourceName to the view
    projectsOnHold,
    startDate,
    endDate,
    msg,
  });
});

// route to render monthly plan for viewers
router.get("/monthlyplan", isAuthenticated, isFTE, async (req, res) => {
  const { monthStart, monthEnd } = getDateRangeForMonth();
  const startDate = new Date(monthStart);
  const endDate = new Date(monthEnd);

  const { interventionName, resourceName } = req.query; // Get filters from query parameters

  // Fetch activities within the date range
  let activities = await taskModel.find({
    $and: [
      {
        $or: [
          { start: { $gte: startDate, $lte: endDate } }, // starts within the month
          { Finish: { $gte: startDate, $lte: endDate } }, // finishes within the month
          {
            $and: [
              { start: { $lt: startDate } },
              { Finish: { $gt: endDate } },
            ], // starts before the month and finishes after the month
          },
          {
            $and: [{ Finish: { $lt: startDate }, taskCompletePercent: { $lt: 100 } }],
          }, // Task has finish date in past month but is still incomplete
        ],
      },
      { source: "PWA" },
      { ProjectStatus: { $ne: "On Hold" } },
    ],
  }).sort({ typeofActivity: -1, interventionName: 1, taskIndex: 1 });

  // Add isDelayed property to each activity based on its delay status
  activities.forEach(activity => {
    activity.isDelayed = isDelayed(activity);
  });

  // Apply projectName filter if provided
  if (interventionName) {
    activities = activities.filter(activity => activity.interventionName === interventionName);
  }

  // Apply resourceName filter if provided
  if (resourceName) {
    activities = activities.filter(activity => activity.resourceName === resourceName);
  }

  // Group activities by typeofActivity
  const groupedActivities = activities.reduce((acc, activity) => {
    if (!acc[activity.typeofActivity]) {
      acc[activity.typeofActivity] = [];
    }
    acc[activity.typeofActivity].push(activity);
    return acc;
  }, {});

  // Flatten groupedActivities to extract unique project and resource names
  const flattenedActivities = Object.values(groupedActivities).flat();
  const interventionNames = [...new Set(flattenedActivities.map(activity => activity.interventionName))];
  const resourceNames = [...new Set(flattenedActivities.map(activity => activity.resourceName))];

  const projectsOnHold = await taskModel.distinct("projectName", { ProjectStatus: "On Hold" });

  res.render("monthlyplan", {
    groupedActivities,
    interventionNames,
    resourceNames,
    selectedInterventionName: interventionName || "",
    selectedResourceName: resourceName || "",
    projectsOnHold,
    monthStart,
    monthEnd,
  });
});

// LOGOUT route  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
router.post("/logout", isSessionActive, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send("Failed to logout");
    }
    res.redirect("/");
  });
});

// show resource list from resourceModel   /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
router.get("/resourcelist", isAdmin, async (req, res) => {
  const resource = await resourceModel.find().sort({ resourceName: 1 });
  console.log("rendering the resource list and length is: ", resource.length);
  res.render("resourcelist", { resource });
});

// REFRESH Resource List To used by admin
router.get('/refreshresourcelist', isAdmin, async (req, res) => {
  const accessToken = req.session.token;
  const user = req.session.user;
  let sessions;
  if(!user || !accessToken){
    // console.log("Either User or Access Token is missing.");
    res.render('home', {sessions, msg: "Please login to proceed with the action."});
  }
  try {
    const result = await resourceModel.deleteMany({});
    // console.log(`Deleted ${result.deletedCount} documents from the resourceModel collection.`);
  } catch (error) {
    console.error('Error deleting documents:', error);
  }

    await initializeResources(accessToken);
    res.redirect('/resourcelist');


});

// REFRESH DATABASE TASKS BY ADMIN  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
router.get("/refreshdatabase", isAdmin, async (req, res) => {
  const accessToken = req.session.token;
  const user = req.session.user;
  if(!user || !accessToken){
    console.log("Either User or Access Token is missing.");
    res.render('index', { msg: "Please login to proceed with the action."});
  }
  // Function to fetch Data from all 3 APIs required for the data sync
  async function fetchDataFromAPIs() {
    //Get data from Project API 
    const projectAPIresponse = await axios.get(
      "https://chrysalishrd.sharepoint.com/pwa/_api/ProjectData/Projects",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );
    const allprojects = projectAPIresponse.data.value;

    // Filter out completed projects
    const nonCompleteProjects = allprojects.filter(
          (project) => project.ProjectStatus !== "Completed"
        );
    //get data from Tasks API
    const tasksPromises = nonCompleteProjects.map(async (project) => {
      const projectId = project.ProjectId;
      const tasksResponse = await axios.get(
        `https://chrysalishrd.sharepoint.com/pwa/_api/ProjectData/Projects(guid'${projectId}')/Tasks`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }
      );      
      return tasksResponse.data.value;
    });
    const taskarray = await Promise.all(tasksPromises);
    
    const alltasks = taskarray.flat();
    const activeTasks = alltasks.filter(
      (task) => task.TaskIsActive === true
    );
    const leapTasks = activeTasks.filter(
      (task) =>
        task.LEAPApplicationSync === "Yes" ||
          task.LEAPApplicationSync === "yes"
    );
        
    // get data from Assignments API
  
    const assignmentsPromises = nonCompleteProjects.map(
      async (project) => {
        const projectId = project.ProjectId;
        const assignmentsResponse = await axios.get(
          `https://chrysalishrd.sharepoint.com/pwa/_api/ProjectData/Projects(guid'${projectId}')/Assignments`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          }
        );

        return assignmentsResponse.data.value;
      }
    );
    const assignments = await Promise.all(assignmentsPromises);
    const allassignments = assignments.flat();
  
    return { projects: nonCompleteProjects, tasks: leapTasks, resources: allassignments  }; 
  }
  

  async function updateOrInsertTasks() {
    try {
      const { projects, tasks, resources } = await fetchDataFromAPIs();

      const newTaskIds = tasks.map(task => task.TaskId);
      await taskModel.deleteMany({ taskId: { $nin: newTaskIds }, source: "PWA" }); //delete tasks from database that are deleted by PM

  
      for (const task of tasks) {
        const project = projects.find(proj => proj.ProjectId === task.ProjectId);
        if (project) {
          task.ClientName = project.ClientName;
          task.InterventionName = project.InterventionName;
          task.ProjectStatus = project.ProjectStatus;
          task.ProjectPercentWorkCompleted = project.ProjectPercentWorkCompleted;
        }
  
        const resource = resources.find(res => res.TaskId === task.TaskId);
        if (resource) {
          task.ResourceId = resource.ResourceId;
          task.ResourceName = resource.ResourceName;
        }
  
        const existingTask = await taskModel.findOne({ taskId: task.TaskId });
  
        if (existingTask) {
          // Update existing task
          existingTask.start = task.TaskStartDate;
          existingTask.Finish = task.TaskFinishDate;
          existingTask.taskCompletePercent = task.TaskPercentWorkCompleted;
          existingTask.LeapSync = task.LEAPApplicationSync;
          existingTask.clientName = task.ClientName;
          existingTask.interventionName = task.InterventionName;
          existingTask.resourceId = task.ResourceId;
          existingTask.resourceName = task.ResourceName;
          existingTask.parentTaskName = task.ParentTaskName;
          existingTask.typeofActivity = task.TypeofActivity;
          existingTask.taskIsActive = task.TaskIsActive;
          existingTask.taskName = task.TaskName;
          existingTask.taskWork = task.TaskWork;
          existingTask.ProjectPercentWorkCompleted = task.ProjectPercentWorkCompleted;
          existingTask.ProjectStatus = task.ProjectStatus;
          existingTask.projectName = task.ProjectName;
          existingTask.consultingDay = task.ConsultingDay;
          existingTask.taskIndex = task.TaskIndex;
          await existingTask.save();
        } else {
          // Insert new task
          const newTask = new taskModel({
            projectId: task.ProjectId,
            projectName: task.ProjectName,
            ProjectPercentWorkCompleted: task.ProjectPercentWorkCompleted,
            ProjectStatus: task.ProjectStatus,
            taskId: task.TaskId,
            taskName: task.TaskName,
            parentTaskName: task.ParentTaskName,
            start: task.TaskStartDate,
            Finish: task.TaskFinishDate,
            taskWork: task.TaskWork,
            typeofActivity: task.TypeofActivity,
            taskCompletePercent: task.TaskPercentWorkCompleted,
            LeapSync: task.LEAPApplicationSync,
            resourceId: task.ResourceId,
            resourceName: task.ResourceName,
            clientName: task.ClientName,
            interventionName: task.InterventionName,
            consultingDay: task.ConsultingDay,
            taskIndex: task.TaskIndex,
            taskIsActive: task.TaskIsActive,
          });
          await newTask.save();
        }
      }
      console.log('Tasks updated or inserted successfully');
    } catch (error) {
      console.error('Error updating or inserting tasks:', error);
    }
  }

  // Call the function to update or insert tasks
  await updateOrInsertTasks();

  res.redirect('/alltasks');

});

// all tasks for admin  ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
router.get("/alltasks", isAuthenticated, async (req, res) => {
  try {
    const { projectName, resourceName } = req.query; // Get filters from query parameters

    // Build the query object dynamically
    const query = {};
    if (projectName) {
      query.projectName = projectName;
    }
    if (resourceName) {
      query.resourceName = resourceName;
    }

    // Fetch filtered tasks from the database
    const tasks = await taskModel.find(query).sort({ projectName: 1, taskIndex: 1 });

    // Render the page with filtered tasks and selected filters
    res.render("alltasks", { tasks, selectedProject: projectName || "", selectedResource: resourceName || "" });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).send("An error occurred while fetching tasks.");
  }
});

// route to filter TasksToUpdate which are approved in LEAP and need to update status in PWA
router.get('/taskstoupdate', isAdmin, async (req, res, next) => {
  try {
    // Query the database for tasks that match the criteria
    const filteredTasks = await taskModel.find({
      source: 'PWA',
      approvalStatus: 'Approved',
      taskCompletePercent: { $lt: 100 } // Incomplete tasks
    }).sort({ projectName: 1, taskIndex: 1 }); // Sort by projectName and taskIndex

    // Render the filtered tasks
    res.render('taskstoupdate', { tasks: filteredTasks });
  } catch (error) {
    console.error('Error filtering PWA tasks:', error);
    next(error); // Pass the error to the next middleware
    // res.status(500).send('An error occurred while filtering tasks.');
  }
});

//route to filter and sort PWA tasks by last updated by the resource in the LEAP
router.get('/sortbyupdate', isAdmin, async (req, res) => {
  try {
    const { projectName, resourceName } = req.query; // Get filters from query parameters

    // Build the match stage dynamically
    const matchStage = {
      workBreakdown: { $exists: true, $ne: [] },
      taskId: { $not: /^MTE/ },
      approvalStatus: { $ne: "Approved" },
    };
    if (projectName) {
      matchStage.interventionName = projectName; // Intervention Name is stored in projectName
    }
    if (resourceName) {
      matchStage.resourceName = resourceName;
    }

    // Build the sort stage
    let sortStage = { latestWorkDate: -1 };
    if (resourceName) {
      // If resourceName is provided, sort by resourceName then latestWorkDate
      sortStage = { resourceName: 1, latestWorkDate: -1 };
    }

    const sortedTasks = await workModel.aggregate([
      { $match: matchStage },
      { $addFields: { latestWorkDate: { $max: "$workBreakdown.date" } } },
      { $sort: sortStage }
    ]);

    res.render('latesttaskupdates', {
      tasks: sortedTasks,
      selectedProject: projectName || "",
      selectedResource: resourceName || ""
    });
  } catch (error) {
    console.error('Error sorting tasks:', error);
    res.status(500).send('An error occurred while sorting tasks.');
  }
});

//Route to list all delayed tasks with delayStatus other than NA
router.get('/delayedtasks', isAdmin, async (req, res) => {
  try {
    //check param msg in query string to show success message
    let msg = "";
    if (req.query.msg === "successupdate") {
      msg = "Delay status updated successfully.";
    } else if (req.query.msg === "failupdate") {
      msg = "Failed to update delay status. Please try again.";
    } else if (req.query.msg === "error") {
      msg = "An error occurred while updating the delay status. Please try again.";
    }
    const delayedTasks = await taskModel.find({
      delayStatus: { $ne: "NA" },
      taskCompletePercent: { $lt: 100 },
      source: "PWA"
    }).sort({ interventionName: 1, taskIndex: 1 });

    res.render('delayedtasks', { tasks: delayedTasks, msg }); // Render the delayed tasks page with the tasks and message
  } catch (error) {
    console.error('Error fetching delayed tasks:', error);
    res.status(500).redirect('/delayedtasks?msg=error'); // Redirect with an error message if there's an issue
  }
});

// Route to handle delay status update by admin and change the delayStatus in document
router.post('/delayedtasks', isSessionActive, isAdmin, async (req, res) => {
  try {
    const { taskId, delayStatus } = req.body; // Get the taskId and new delayStatus from the request body
    // console.log("Received taskId:", taskId, "and delayStatus:", delayStatus);
    // Validate the input
    if (!taskId || !delayStatus) {
      return res.status(400).send('Task ID and delay status are required.');
    }
    // Update the delayStatus for the specified task
    const updatedTask = await taskModel.findOneAndUpdate(
      { _id: taskId },
      { delayStatus: delayStatus },
      { new: true } // Return the updated document
    );
    // Check if the task was found and updated
    if (!updatedTask) {
      res.redirect('/delayedtasks?msg=failupdate');
    }
    // Redirect back to the delayed tasks page with a success message
    res.redirect('/delayedtasks?msg=successupdate');
  } catch (error) {
    console.error('Error updating delay status:', error);
    res.status(500).redirect('/delayedtasks?msg=error'); // Redirect with an error message if there's an issue
  }
}); 

// Save PWA task details for first time in the database and then it can be updated or submitted to manager for approval
router.post("/savetask", isSessionActive, async (req, res) => {
  let { activityId, actualStart, actualFinish, actualWork, comment, completed } = req.body;
  comment = sanitizeUserComment(comment);
  const datedComment = "(" + new Date().toLocaleDateString("en-in") + ": " + actualWork + " Hrs)" + comment;

  try {
    // Update the task
    const save = await taskModel.findByIdAndUpdate(activityId, {
      actualStart: new Date(actualStart),
      actualFinish: new Date(actualFinish),
      actualWork: actualWork,
      userComment: datedComment,
      saved: 1,
      leapComplete: completed,
      approvalStatus: "Saved, Awaiting Submission",
    });

    if (!save) {
      console.log("Task data failed to save.");
      res.redirect("/profile?msg=failsave");
    } else {
      console.log("Task data saved successfully");

      // Update the work breakdown
      await updateWorkBreakdown(save.taskId, actualWork);

      res.redirect("/profile?msg=successsave");
    }
  } catch (error) {
    console.error("Error in /savetask route:", error.message);
    res.redirect("/profile?msg=failsave");
  }
});

//UPDATE saved tasks by member before submission. 
router.post("/updatetask", isSessionActive, async (req, res) => {
  let { actualFinish, actualWork, comment, completed, activityId } = req.body;
  comment = sanitizeUserComment(comment);
  const existingTask = await taskModel.findById(activityId);
  const existingWorkDone = existingTask.actualWork;
  const previousComment = existingTask.userComment || ""; // Get the existing comment or an empty string if none exists
  if (!actualFinish) {
    actualFinish = existingTask.actualFinish;
  }

  const datedComment = "(" + new Date().toLocaleDateString("en-in") + ": " + actualWork + " Hrs) " + comment;
  const newComment = previousComment + "; " + datedComment; // Concatenate the previous comment with the new dated comment

  try {
    // Update the task
    const update = await taskModel.findByIdAndUpdate(activityId, {
      actualFinish: new Date(actualFinish),
      actualWork: Number(existingWorkDone) + Number(actualWork),
      userComment: newComment,
      leapComplete: completed,
    });

    if (!update) {
      console.log("Failed to update Task data.");
      res.redirect("/profile?msg=failupdate");
    } else {
      console.log("Task data updated successfully!");

      // Update the work breakdown
      await updateWorkBreakdown(update.taskId, actualWork);

      res.redirect("/profile?msg=successupdate");
    }
  } catch (error) {
    console.error("Error in /updatetask route:", error.message);
    res.redirect("/profile?msg=failupdate");
  }
});

// Manager route to render tasks for all membes under a manager.
router.get('/manager', isManager, async (req, res) => {
  try {
  const user = req.session.user;
  const managerName = user.name;
  const teamMembers = await resourceModel.find({resourceManagerName : managerName});
  const tasksForAllMembers = await Promise.all(
    teamMembers.map(async (member) => {
      const tasks = await taskModel.find({ resourceName: member.resourceName, submitted: 1, consultingDay: { $ne: 'No'} });
      return tasks;
    })
  );
  
  const flattenedTasks = tasksForAllMembers.flat();
  // Group tasks by member
    const groupedMembers = flattenedTasks.reduce((acc, task) => {
      if (!acc[task.resourceName]) {
        acc[task.resourceName] = [];
      }
      acc[task.resourceName].push(task);
      return acc;
    }, {});
    // console.log('Grouped Activities:', groupedMembers);
  let msg;

  res.render('manager', {tasks: flattenedTasks, groupedMembers, user, msg});
    
  } catch (error) {
    console.log(error.message);
  }
});

// Submit tasks with consulting day YES to manager for approval and tasks with consulting day NO to be approved or reassigned immediately.
router.post('/submitToManager', isSessionActive, async (req, res) => {
  try {
    const user = req.session.user; // Authentication check and can get the logged-in user's ID

    // Update tasks with consultingDay = Yes or NA
    const updateYes = {
      submitted: 1,
      approvalStatus: "Submitted. Awaiting Approval"
    };
    await taskModel.updateMany({ resourceName: user.name, saved: 1, submitted: 0, consultingDay: { $ne: 'No'} }, updateYes);

    // Handle tasks with consultingDay = No
    const tasksNo = await taskModel.find({ resourceName: user.name, saved: 1, submitted: 0, consultingDay: "No" });
    const updatePromises = tasksNo.map(async (task) => {
      if (task.leapComplete === 100) {
        return taskModel.findByIdAndUpdate(task._id, { submitted: 2, approvalStatus: "Approved" });
      } else {
        return taskModel.findByIdAndUpdate(task._id, { submitted: 0, approvalStatus: "Reassigned" });
      }
    });
    await Promise.all(updatePromises);

    res.json({ success: true, message: 'Tasks processed successfully!' });
  } catch (err) {
    console.error("Error in /submitToManager route:", err);
    res.json({ success: false, message: 'Failed to process tasks.' });
  }
});


router.post('/approve', isSessionActive, isManager, async (req, res) => {
  try {
    const user = req.session.user;
    let approved = 0;
    let reassigned = 0;
    const { resourceName } = req.body;
    // console.log("/approve is running. Resource name is: ", resourceName);

    const tasks = await taskModel.find({ resourceName: resourceName, submitted: 1, consultingDay: { $ne: 'No'} });
    // console.log("Result of db find: ", tasks);

    const updatePromises = tasks.map(async (task) => {
      if (task.leapComplete === 100) {
        await taskModel.findByIdAndUpdate(task._id, { submitted: 2, approvalStatus: "Approved" });
        console.log("Task approved: ", task.taskName);
        approved += 1;
      } else {
        await taskModel.findByIdAndUpdate(task._id, { submitted: 0, approvalStatus: "Reassigned" });
        console.log("Task reassigned: ", task.taskName);
        reassigned += 1;
      }
    });

    await Promise.all(updatePromises);

    const result = await resourceModel.findOneAndUpdate({resourceName: resourceName}, {managerComment: ""});
    console.log("Number of tasks approved: ", approved);
    console.log("Number of tasks reassigned: ", reassigned);

    res.json({ success: true, message: `Tasks processed. Approved: ${approved}, Reassigned: ${reassigned}` });
  } catch (err) {
    console.error("Error in /approve route: ", err);
    res.json({ success: false, message: 'Failed to submit items.' });
  }
});
// Route to handle Reassign tasks from Manager to make all tasks where saved =1 and submitted= 1 to submitted = 0 and save comment in resourceModel
router.post('/reassign', isSessionActive, isManager, async (req, res) => {
  try {
    const {resourceName, comment} = req.body;
    // console.log('req body resource name is: ', resourceName);
    // console.log('req body comment is: ', comment);
    const tasks = await taskModel.find({resourceName: resourceName, submitted: 1});
    // console.log("Result of db find: ", tasks);
    if (tasks.length > 0) {
      // Update all matching tasks
      await taskModel.updateMany(
        { resourceName: resourceName, submitted: 1 },
        { $set: { submitted: 0, approvalStatus: "Reassigned" } }
      );
      // console.log(`${tasks.length} tasks reassigned.`);
    }
    const result = await resourceModel.findOneAndUpdate({resourceName: resourceName}, {managerComment: comment});

    res.json({ success: true, message: `Tasks processed.` });
    
  } catch (err) {
    console.error("Error in /reassign route: ", err);
    res.json({ success: false, message: 'Failed to submit items.' });
  }
});

// Route to render Escalation for delayed tasks.
router.get('/escalation', isLeadership,  async (req, res, next) => {
  try {
    const user = req.session.user;
    const today = new Date().toISOString().split('T')[0] + "T00:00:00";
    const tasks = await taskModel.find({
      Finish: { $lt: today },
      taskCompletePercent: { $lt: 100 },
      ProjectStatus: { $ne: "On Hold" },
      source: "PWA"
    });
    tasks.forEach(task => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const finishDate = new Date(task.Finish);
      finishDate.setHours(0, 0, 0, 0);
      const delayInDays = Math.floor((today - finishDate) / (1000 * 60 * 60 * 24));
      task.delayInDays = delayInDays;
    });
    const projectsOnHold = await taskModel.distinct('projectName', { ProjectStatus: "On Hold" });
      res.render('escalation', {plainTasks: tasks, projectsOnHold});
  } catch (error) {
    console.log(error.message);
    next(error);
  }
});

// Route to refresh the task archive
router.get("/refresharchive", isAdmin, async (req, res) => {
  try {
    // Find all tasks with ProjectStatus = 'Completed'
    const completedTasks = await taskModel.find({
      $or: [
        { ProjectStatus: "Completed" },
        { source: "MTE", approvalStatus: "Approved" },
        {taskCompletePercent: 100},
      ]
    });

    if (completedTasks.length === 0) {
      // return res.status(200).send("No completed tasks found to archive.");
      return res.redirect('/archivedtasks?msg=archive up to date');
    }

    // Insert completed tasks into the archive collection
    await taskArchiveModel.insertMany(completedTasks);

    // Remove the completed tasks from the tasks collection
    await taskModel.deleteMany({ 
      $or: [
        { ProjectStatus: "Completed" },
        { source: "MTE", approvalStatus: "Approved" }  
      ] 
     });

    // res.status(200).send(`${completedTasks.length} tasks archived successfully.`);
    res.redirect('/archivedtasks?msg=success');
  } catch (error) {
    console.error("Error refreshing archive:", error);
    // res.status(500).send("An error occurred while refreshing the archive.");
    res.redirect('/archivedtasks?msg=fail');
  }
});

// Route to view grouped and sorted archived tasks
router.get("/archivedtasks", isAdmin, async (req, res) => {
  try {
    // Fetch all archived tasks and sort by projectName and taskIndex
    const archivedTasks = await taskArchiveModel.find().sort({ projectName: 1, taskIndex: 1 });

    if (archivedTasks.length === 0) {
      // return res.status(200).send("No archived tasks found.");
      return res.redirect('/admin?msg=archive_empty');
    }

    // Group tasks by projectName
    const groupedTasks = archivedTasks.reduce((acc, task) => {
      if (!acc[task.projectName]) {
        acc[task.projectName] = [];
      }
      acc[task.projectName].push(task);
      return acc;
    }, {});

    // Render the grouped and sorted tasks
    res.render("archivedtasks", { groupedTasks });
  } catch (error) {
    console.error("Error fetching archived tasks:", error);
    res.status(500).send("An error occurred while fetching archived tasks.");
  }
});

// route to get the chrysalis Projects Portfolio dashboard
router.get('/reports', isLeadership, async (req, res) => {
  try {
    // Fetch all tasks from both collections
    const tasks = await taskModel.find({});
    const archivedTasks = await taskArchiveModel.find({});
    const allTasks = [...tasks, ...archivedTasks];

    // Group by clientName, then by interventionName
    const groupedByClient = {};

    allTasks.forEach(task => {
      const client = task.clientName || 'Unknown Client';
      const intervention = task.interventionName || 'Unknown Intervention';
      const isBillable = task.consultingDay === 'Yes' && task.source === 'PWA';
      const isNonBillable = task.consultingDay === 'No' || task.source === 'MTE';
      const workHours = task.actualWork || 0;

      if (!groupedByClient[client]) {
        groupedByClient[client] = {
          interventions: {},
          billable: 0,
          nonBillable: 0,
          total: 0
        };
      }
      if (!groupedByClient[client].interventions[intervention]) {
        groupedByClient[client].interventions[intervention] = { billable: 0, nonBillable: 0, total: 0 };
      }

      if (isBillable) {
        groupedByClient[client].interventions[intervention].billable += workHours;
        groupedByClient[client].billable += workHours;
      } else if (isNonBillable) {
        groupedByClient[client].interventions[intervention].nonBillable += workHours;
        groupedByClient[client].nonBillable += workHours;
      }
      groupedByClient[client].interventions[intervention].total += workHours;
      groupedByClient[client].total += workHours;
    });

    // Prepare client and intervention lists for filters
    const clientNames = Object.keys(groupedByClient);
    const interventionNamesByClient = {};
    clientNames.forEach(client => {
      interventionNamesByClient[client] = Object.keys(groupedByClient[client].interventions);
    });

    // get project status for each intervention
    const interventionDetailsByClient = {};

for (const client of clientNames) {
  interventionDetailsByClient[client] = {};
  for (const intervention of interventionNamesByClient[client]) {
    // Find the first matching task in either model for this client and intervention
    let task = await taskModel.findOne({ clientName: client, interventionName: intervention });
    if (!task) {
      task = await taskArchiveModel.findOne({ clientName: client, interventionName: intervention });
    }
    interventionDetailsByClient[client][intervention] = {
      projectStatus: task ? task.ProjectStatus || 'Unknown' : 'Unknown'
    };
  }
}

    // Calculate overall totals
    let totalBillableHours = 0;
    let totalNonBillableHours = 0;
    clientNames.forEach(client => {
      totalBillableHours += groupedByClient[client].billable;
      totalNonBillableHours += groupedByClient[client].nonBillable;
    });
    // console.log("interventionNamesByClient is: ", interventionNamesByClient);
    res.render('reports', {
      groupedByClient,
      clientNames,
      interventionNamesByClient,
      interventionDetailsByClient,
      totalBillableHours,
      totalNonBillableHours
    });
  } catch (error) {
    console.error("Error generating reports:", error);
    res.status(500).send("An error occurred while generating the reports.");
  }
});

// Route to show reports for resources hours for projects.
router.get('/resourcereport', isLeadership, async (req, res) => {
  try {
    const user = req.session.user;

    // Get the search term, selected resource name, and time period from the query parameters
    const searchTerm = req.query.search || '';
    const selectedResourceName = req.query.resourceName || '';
    const timePeriod = req.query.timePeriod || 'alltime'; // Default to current month

    // If no search term or resource name is provided, render the search form
    if (!searchTerm && !selectedResourceName) {
      return res.render('resourcereport', {
        interventionNames: [],
        billableHours: [],
        nonBillableHours: [],
        totalBillableHours: 0,
        totalNonBillableHours: 0,
        searchResults: [],
        searchTerm,
        selectedResourceName,
        timePeriod,
        startDate:  '',
        endDate: '',
      });
    }

    // If a search term is provided, search for matching resources
    let searchResults = [];
    if (searchTerm) {
      searchResults = await resourceModel.find({
        resourceName: { $regex: searchTerm, $options: 'i' }, // Case-insensitive partial match
      });

      // If search results are found, display them
      if (searchResults.length > 0) {
        return res.render('resourcereport', {
          interventionNames: [],
          billableHours: [],
          nonBillableHours: [],
          totalBillableHours: 0,
          totalNonBillableHours: 0,
          searchResults,
          searchTerm,
          selectedResourceName: '', // Clear selectedResourceName when showing search results
          timePeriod,
          startDate:  '',
          endDate: '',  
        });
      }
    }

    // If a resource is selected, fetch tasks for that resource within the selected time period
    let interventionNames = [];
    let billableHours = [];
    let nonBillableHours = [];
    let totalBillableHours = 0;
    let totalNonBillableHours = 0;

    let startDate, endDate;
    if (selectedResourceName) {
      // Determine the date range based on the selected time period
      const today = new Date();
      switch (timePeriod) {
        case 'lastMonth':
          startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
          endDate = new Date(today.getFullYear(), today.getMonth(), 0);
          break;
        case 'lastQuarter':
          const currentQuarter = Math.floor(today.getMonth() / 3);
          startDate = new Date(today.getFullYear(), (currentQuarter - 1) * 3, 1);
          endDate = new Date(today.getFullYear(), currentQuarter * 3, 0);
          break;
        case 'currentYear':
          startDate = new Date(today.getFullYear(), 0, 1);
          endDate = new Date(today.getFullYear(), 11, 31);
          break;
        case 'currentMonth':
          startDate = new Date(today.getFullYear(), today.getMonth(), 1);
          endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          break;          
        case 'allTime':
        default:
          startDate = new Date(0); // Earliest possible date
          endDate = new Date(); // Current date
          break;
      }

      // Fetch tasks for the selected resource within the date range from both models
      const query = {
        resourceName: selectedResourceName,
        start: { $gte: startDate },
        Finish: { $lte: endDate },
        actualWork: { $gt: 0 },
      };

      const tasksCurrent = await taskModel.find(query);
      const tasksArchived = await taskArchiveModel.find(query);
      const tasks = [...tasksCurrent, ...tasksArchived];

      // Group tasks by projectName and calculate billable and non-billable hours
      const groupedData = tasks.reduce((acc, task) => {
        if (!acc[task.interventionName]) {
          acc[task.interventionName] = { billable: 0, nonBillable: 0 };
        }

        if (task.consultingDay === 'Yes' && task.source === 'PWA') {
          acc[task.interventionName].billable += task.actualWork || 0;
        } else if (task.consultingDay === 'No' || task.source === 'MTE') {
          acc[task.interventionName].nonBillable += task.actualWork || 0;
        }

        return acc;
      }, {});

      // Prepare data for the chart
      interventionNames = Object.keys(groupedData);
      billableHours = interventionNames.map(project => groupedData[project].billable);
      nonBillableHours = interventionNames.map(project => groupedData[project].nonBillable);

      // Calculate total billable and non-billable hours
      totalBillableHours = billableHours.reduce((sum, hours) => sum + hours, 0);
      totalNonBillableHours = nonBillableHours.reduce((sum, hours) => sum + hours, 0);
    }

    // Render the chart view
    res.render('resourcereport', {
      interventionNames,
      billableHours,
      nonBillableHours,
      totalBillableHours,
      totalNonBillableHours,
      searchResults: [],
      searchTerm,
      selectedResourceName,
      timePeriod,
      startDate,
      endDate,
    });
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).send('An error occurred while generating the report.');
  }
});

router.get('/clientreport', isLeadership, async (req, res) => {
  try {
    const { clientName, projectName } = req.query;

    // Fetch all unique client names from taskModel and taskArchiveModel
    const clientNames = await taskModel.distinct('clientName');
    const archivedClientNames = await taskArchiveModel.distinct('clientName');
    const allClientNames = [...new Set([...clientNames, ...archivedClientNames])];
    // Fetch all unique project names for the selected client
    let projectNames = [];
    if (clientName) {
      const taskProjects = await taskModel.distinct('projectName', { clientName });
      const archivedTaskProjects = await taskArchiveModel.distinct('projectName', { clientName });
      projectNames = [...new Set([...taskProjects, ...archivedTaskProjects])];
    }
    const customOrder = ["REBL", "TBL", "Administration", "Resourcing & Facilitation", "Project Management", "Technology", "Talent", "Finance", "Leadership"]
    // Fetch resources grouped by resourceFunction
    const resources = await resourceModel.find({});
    const groupedResources = resources.reduce((acc, resource) => {
      const functionName = resource.resourceFunction || 'Unknown';
      if (!acc[functionName]) {
        acc[functionName] = [];
      }
      acc[functionName].push(resource);
      return acc;
    }, {});

    // Fetch tasks for each resourceFunction
    const groupedByFunction = {};
    for (const [functionName, resourceList] of Object.entries(groupedResources)) {
      const resourceIds = resourceList.map((resource) => resource.resourceId);
      const resourceNames = resourceList.map((resource) => resource.resourceName);

      // Query tasks for the resources in this function
      const query = { actualWork: { $gt: 0 }, $or: [{ resourceId: { $in: resourceIds } }, { resourceName: { $in: resourceNames } }] };
      if (clientName) query.clientName = clientName;
      if (projectName) query.projectName = projectName;

      const tasks = await taskModel.find(query);
      const archivedTasks = await taskArchiveModel.find(query);
      const allTasks = [...tasks, ...archivedTasks];

      // Calculate billable, non-billable, and total hours for this function
      const functionData = allTasks.reduce(
        (acc, task) => {
          const isBillable = task.consultingDay === 'Yes';
          const workHours = task.actualWork || 0;

          if (isBillable) {
            acc.billable += workHours;
          } else {
            acc.nonBillable += workHours;
          }
          acc.total += workHours;

          // Group by resourceName within the function
          const resourceName = task.resourceName || 'Unknown';
          if (!acc.resources[resourceName]) {
            acc.resources[resourceName] = { billable: 0, nonBillable: 0, total: 0 };
          }

          if (isBillable) {
            acc.resources[resourceName].billable += workHours;
          } else {
            acc.resources[resourceName].nonBillable += workHours;
          }
          acc.resources[resourceName].total += workHours;

          return acc;
        },
        { billable: 0, nonBillable: 0, total: 0, resources: {} }
      );

      // Only include functions with total hours > 0
      if (functionData.total > 0) {
        // Filter out resources with total hours <= 0
        functionData.resources = Object.fromEntries(
          Object.entries(functionData.resources).filter(([_, resourceData]) => resourceData.total > 0)
        );

        groupedByFunction[functionName] = functionData;
      }
    }

    // Sort the groupedByFunction keys based on customOrder
const sortedGroupedByFunction = {};

// Add functions that exist in customOrder first in the specified order
customOrder.forEach(fn => {
  if (groupedByFunction[fn]) {
    sortedGroupedByFunction[fn] = groupedByFunction[fn];
  }
});

// Optionally, add any remaining functions (not listed in customOrder) sorted alphabetically
Object.keys(groupedByFunction)
  .filter(fn => !customOrder.includes(fn))
  .sort()
  .forEach(fn => {
    sortedGroupedByFunction[fn] = groupedByFunction[fn];
  });

    // Calculate total billable and non-billable hours
    const totalBillableHours = Object.values(groupedByFunction).reduce((sum, func) => sum + func.billable, 0);
    const totalNonBillableHours = Object.values(groupedByFunction).reduce((sum, func) => sum + func.nonBillable, 0);
    console.log(`grouped functions are : ${JSON.stringify(groupedByFunction)}`);
    res.render('clientreport', {
      clientNames: allClientNames,
      selectedClientName: clientName || '',
      projectNames,
      selectedProjectName: projectName || '',
      groupedByFunction: sortedGroupedByFunction,
      totalBillableHours,
      totalNonBillableHours,
    });
  } catch (error) {
    console.error('Error generating client report:', error);
    res.status(500).send('An error occurred while generating the client report.');
  }
});

module.exports = router;