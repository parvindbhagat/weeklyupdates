var express = require("express");
var router = express.Router();
const session = require("express-session");
const {task: taskModel, taskArchive: taskArchiveModel }= require("./task");
const resourceModel = require("./resource");
require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");
const {getAccessToken, cca: msal } = require("../authconfig");
const qs = require("qs");
const moment = require("moment");
// const { InteractionRequiredAuthErrorCodes } = require("@azure/msal-node");
// const { getAccessToken, cca } = require("../authgraph");


// function to check user is logged in with MSAL Auth flow
function isAuthenticated(req, res, next) {
  console.log("isAuthenticated function called");
  if (req.session.user) {
    // console.log('Session data:', req.session);
    // console.log('isAuthenticated-if user: Session user data:', req.session.user);
    console.log("User is logged in, calling next");
    return next();
  } else {
    req.session.originalUrl = req.originalUrl; // Store the original URL.
    // console.log('isAuthenticated-else: session user data is :', req.session.user);
    // console.log("User Not logged in, stored url and redirecting to /login, stored url is: ", req.session.originalUrl );
    res.redirect("/login");
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
      consultingDay: "Yes",
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

//check referrer to allow only from the chrd site
function checkReferrer(req, res, next) {
  const referrer = req.get('Referrer') || req.get('Referer'); // Some browsers use 'Referer' instead of 'Referrer'
  const allowedDomains = [
      /\.chrysalis\.in\/.*/,
      /\.chrysalisonline\.in\/.*/,
      /\.chrysalistechnologies\.in\/.*/
  ];

  if (referrer && allowedDomains.some(domain => domain.test(referrer))) {
      return next();
  } else {
      res.status(403).send('Invalid access, please visit chrysalis.in to log in');
  }
}

//GET APP HOME
router.get("/", async (req, res) => {  
    let msg = "";
  res.render("index", { msg });
});

router.get("/leap", isAuthenticated, isFTE, async (req, res) => {
  const user = req.session.user;
  const resourceName = user.name;
  const resourceDetails = await resourceModel.findOne({
    resourceName: resourceName,
  });
  let msg = "";
res.render("leap", { msg, resourceDetails });
});

router.get("/home", isAuthenticated, redirectBasedOnGroup, async (req, res) => {  
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
  // Function to determine the resource role
  function determineResourceRole(resourceData) {
    if (
      resourceData.ResourceName === "Anish Thomas" ||
      resourceData.ResourceName === "Parvind Kumar Bhagat"
    ) {
      return "Admin";
    } else if (
      resourceData.ResourceId === resourceData.ResourceTimesheetManageId
    ) {
      return "Manager";
    } else {
      return "Member";
    }
  }

  // function to fill manager Name from Manager id of each resource

  async function fillManagerNames() {
    try {
      // Fetch all resources
      const resources = await resourceModel.find();

      // Create a map of resourceId to resourceName
      const resourceMap = resources.reduce((map, resource) => {
        map[resource.resourceId] = resource.resourceName;
        return map;
      }, {});
      // console.log(resourceMap);
      // Update each resource with the manager's name
      for (const resource of resources) {
        if (
          resource.resourceManagerId &&
          resourceMap[resource.resourceManagerId]
        ) {
          resource.resourceManagerName =
            resourceMap[resource.resourceManagerId];
          await resource.save();
        }
      }

      console.log("Manager names updated successfully.");
    } catch (error) {
      console.error("Error updating manager names:", error);
    }
  }

  //function to initialize resource data if resources collection is empty
  async function initializeResources() {
    try {
      const count = await resourceModel.countDocuments();
      if (count === 0) {
        console.log("Resource collection is empty. Adding resources...");

        const accessToken = req.session.token;
        if (!accessToken) {
          console.log("access token mission. could not fetch resource data. redirecting to login page.");
          res.redirect("/login");
        } else {
          const resourceAPIresponse = await axios.get(
            "https://chrysalishrd.sharepoint.com/pwa/_api/ProjectData/Resources",
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            }
          );
          const RL = resourceAPIresponse.data.value;
          console.log(`The number of resources in the RL are: ${RL.length}`);
          // console.log(`first resource email`)
          for (const resourceData of RL) {
            const {
              ResourceId,
              ResourceEmailAddress,
              ResourceDepartments,
              ResourceName,
              ResourceTimesheetManageId,
            } = resourceData;
            const resourceRole = determineResourceRole(resourceData);
            const resource = new resourceModel({
              resourceId: ResourceId,
              resourceName: ResourceName,
              resourceEmail: ResourceEmailAddress,
              resourceGroup: ResourceDepartments,
              resourceManagerId: ResourceTimesheetManageId,
              resourceRole: resourceRole,
            });
            // console.log(`The resource data is: ${resource} `);
            try {
              await resource.save();
              // console.log(`saved resource: ${ResourceName}`);
            } catch (error) {
              console.error(`Error saving resource: ${ResourceName}`, error);
            }
          }
        }
        //Once the colection is initialized fill manager details from mananger id
        fillManagerNames();
      } else {
        console.log("Resource collection is not empty. No action taken.");
      }
    } catch (err) {
      console.error("Error checking resource collection", err);
    }
  }
  try {
  const user = req.session.user;
  // const accessToken = req.session.token;
  const resourceName = user.name;
  // const encodedName = encodeResourceName(resourceName);
  console.log("LOGGED IN to /profile Name is : ", resourceName);
  await initializeResources();
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
}).sort({start: 1});

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
router.post("/profile", isAuthenticated, async (req, res) => {
  try {
    if(!req.session.user) {
      let sessions;
      res.render("home", {sessions, msg: "You need to be logged in to add a task. Please login and try again."})
    }

    const user = req.session.user;
    // console.log("user details at /post profile is : ", user);  //dev req
    const resourceName = user.name
    const resource = await resourceModel.findOne({resourceName: resourceName });
    const resourceId = resource.resourceId;
    let {projectName, taskName, actualStart, actualFinish, actualWork, userComment, completed} = req.body;
    userComment = sanitizeUserComment(userComment);
    const start = new Date(actualStart);
   
    let Finish = new Date(actualFinish);
    // if(completed === '100'){
    //   console.log('the type of completed in the add a task form is', typeof completed);
    //    Finish = new Date();
    // } //Allow the user to enter any date for finish date.
    // const completePercent = 100;
    const source = "MTE";
    const LEAPApplicationSync = "No";
    const saved = 1;
    approvalStatus = "Saved, Awaiting Submission";
    const clientName = "Chrysalis";
    const datedComment = "(" + new Date().toLocaleDateString('en-in') + ": " + actualWork + " Hrs)" + userComment;

    const task = new taskModel({      
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
      if(savedTask){
        res.redirect("/profile?msg=successadd");
      } else{
        console.log("error saving the task:", taskName);
        // res.render('profile', {msg: "Failed to add task. Please make sure you are looged in and try again."});
        res.redirect("/profile?msg=failadd");
      }
      
    } catch (error) {
      console.log(error.message);
    }
    
  } catch (error) {
    console.log(error.message);
  }
});

// route to show activites for users from the pwa data stored in the database. //////////////////////////////////////////////////////////////////////////////////////
router.get("/pwaactivities", isAuthenticated, isFTE, async (req, res, next) => {
  const { startDate, endDate } = getCurrentWeekDateRange();
  const { projectName } = req.query; // Get the selected projectName from the query parameters
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
  }).sort({ typeofActivity: -1 }); // returns activities with start/finish between current week or activity that either starts or finishes in current week.

  if(projectName){
    activities = activities.filter(activity => activity.projectName === projectName); // Filter activities based on selected projectName
  }

  const projectNames = [...new Set(activities.map(activity =>activity.projectName))]; // Get unique project names from the tasks

  const projectsOnHold = await taskModel.distinct("projectName", { ProjectStatus: "On Hold" });

  // Group activities by typeofActivity
  const groupedActivities = activities.reduce((acc, activity) => {
    if (!acc[activity.typeofActivity]) {
      acc[activity.typeofActivity] = [];
    }
    acc[activity.typeofActivity].push(activity);
    return acc;
  }, {});

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
  res.render("pwaactivities", { groupedActivities, projectNames, selectedProjectName: projectName , projectsOnHold, startDate, endDate, msg });
});

// route to render monthly plan for viewers
router.get("/monthlyplan", isAuthenticated, isFTE,  async(req, res) => {
  const {monthStart, monthEnd} = getDateRangeForMonth();
const startDate = new Date(monthStart);
const endDate = new Date(monthEnd);

const activities = await taskModel.find({
  $and: [
    {
      $or: [
        { start: { $gte: startDate, $lte: endDate } }, // starts within current week
        { Finish: { $gte: startDate, $lte: endDate } },  //Finishes within current week
        {
          $and: [
            { start: { $lt: startDate } },
            { Finish: { $gt: endDate } }
          ]  // such task start before current week and will finish after current week.
        },
        {       $and: [{Finish: { $lt: startDate }, taskCompletePercent: {$lt: 100}}]         }  // Task has finish date in past week but its still incomplete
      ]
    },
    { source: "PWA" },
    {ProjectStatus: { $ne: "On Hold" }}
  ]  
}).sort({ typeofActivity: 1 });  //returns activities with start/finish between current weekor activity that either starts or finish in current week.

  // Group activities by typeofActivity
  const groupedActivities = activities.reduce((acc, activity) => {
    if (!acc[activity.typeofActivity]) {
      acc[activity.typeofActivity] = [];
    }
    acc[activity.typeofActivity].push(activity);
    return acc;
  }, {});
  const projectsOnHold = await taskModel.distinct('projectName', { ProjectStatus: "On Hold" });
  // console.log("length of activities is: ", activities.length);
  res.render('monthlyplan', {groupedActivities, monthStart, monthEnd, projectsOnHold} );
});
// LOGOUT route  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
router.post("/logout", isAuthenticated, (req, res) => {
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
    // Function to determine the resource role
    async function determineResourceRole(resourceData) {
      // Check if the resource is an Admin
      if (
        resourceData.ResourceName === "Anish Thomas" ||
        resourceData.ResourceName === "Parvind Kumar Bhagat"
      ) {
        return "Admin";
      }
    
      // Check if the resource is their own manager
      if (resourceData.ResourceId === resourceData.ResourceTimesheetManageId) {
        return "Manager";
      }
    
      // Check if the resource is a manager for any other resource
      const isManagerForOthers = await resourceModel.exists({
        resourceManagerId: resourceData.ResourceId,
      });
    
      if (isManagerForOthers) {
        return "Manager";
      }
    
      // Default to Member if no other conditions are met
      return "Member";
    }
  
    // function to fill manager Name from Manager id of each resource
  
    async function fillManagerNames() {
      try {
        // Fetch all resources
        const resources = await resourceModel.find();
  
        // Create a map of resourceId to resourceName
        const resourceMap = resources.reduce((map, resource) => {
          map[resource.resourceId] = resource.resourceName;
          return map;
        }, {});
        // console.log(resourceMap);
        // Update each resource with the manager's name
        for (const resource of resources) {
          if (
            resource.resourceManagerId &&
            resourceMap[resource.resourceManagerId]
          ) {
            resource.resourceManagerName =
              resourceMap[resource.resourceManagerId];
            await resource.save();
          }
        }
  
        console.log("Manager names updated successfully.");
      } catch (error) {
        console.error("Error updating manager names:", error);
      }
    }
  
    //function to initialize resource data if resources collection is empty
    async function initializeResources() {
      try {
        const count = await resourceModel.countDocuments();
        if (count === 0) {
          console.log("Resource collection is empty. Adding resources...");
  
          const accessToken = req.session.token;
          if (!accessToken) {
            console.log("access token mission. could not fetch resource data.");
          } else {
            const resourceAPIresponse = await axios.get(
              "https://chrysalishrd.sharepoint.com/pwa/_api/ProjectData/Resources",
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: "application/json",
                },
              }
            );
            const RL = resourceAPIresponse.data.value;
            console.log(`The number of resources in the RL are: ${RL.length}`);
            // console.log(`first resource email`)
            for (const resourceData of RL) {
              const {
                ResourceId,
                ResourceEmailAddress,
                ResourceDepartments,
                ResourceName,
                ResourceTimesheetManageId,
              } = resourceData;
              const resourceRole = await determineResourceRole(resourceData);
              const resource = new resourceModel({
                resourceId: ResourceId,
                resourceName: ResourceName,
                resourceEmail: ResourceEmailAddress,
                resourceGroup: ResourceDepartments,
                resourceManagerId: ResourceTimesheetManageId,
                resourceRole: resourceRole,
              });
              // console.log(`The resource data is: ${resource} `);
              try {
                await resource.save();
                // console.log(`saved resource: ${ResourceName}`);
              } catch (error) {
                console.error(`Error saving resource: ${ResourceName}`, error);
              }
            }
          }
          //Once the colection is initialized fill manager details from mananger id
          fillManagerNames();
        } else {
          console.log("Resource collection is not empty. No action taken.");
        }
      } catch (err) {
        console.error("Error checking resource collection", err);
      }
    }

    await initializeResources();
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

  async function MTEtasks() {
    try {
      const mtetasks = await taskModel.find({ $and: [{ source: "MTE" }, { consultingDay: { $exists: false } }] });
      if (mtetasks.length > 0) {
        const bulkOps = mtetasks.map((task) => ({
          updateOne: {
            filter: { _id: task._id },
            update: { $set: { consultingDay: "Yes" } },
          },
        }));
        await taskModel.bulkWrite(bulkOps);
        console.log(`${mtetasks.length} MTE tasks updated successfully.`);
      }
      }
     catch (error) {
      console.error('Error updating consultingDay for MTE tasks:', error);
    }
  }


  
  // Call the function to update or insert tasks
  await updateOrInsertTasks();

    const count = await taskModel.countDocuments({ consultingDay: { $exists: false } });
        if (count > 0) {
            await MTEtasks();
        }

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
    const tasks = await taskModel.find(query).sort({ projectName: 1, resourceName: 1 });

    // Render the page with filtered tasks and selected filters
    res.render("alltasks", { tasks, selectedProject: projectName || "", selectedResource: resourceName || "" });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).send("An error occurred while fetching tasks.");
  }
});

// route to filter TasksToUpdate
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

// Save PWA task details for first time in the database and then it can be updated or submitted to manager for approval
router.post('/savetask', isAuthenticated, async (req, res) => {
  let { activityId, actualStart, actualFinish, actualWork, comment, completed } = req.body;
  comment = sanitizeUserComment(comment);
  const datedComment = "(" + new Date().toLocaleDateString('en-in') + ": " + actualWork + " Hrs)" + comment;
  // console.log('dated comment is: ', datedComment);
  // if(completed === '100'){
  //   actualFinish = new Date();
  // } //Allow the user to enter any date for finish date.
  // save the activity in the database
  const save = await taskModel.findByIdAndUpdate(activityId, {
      actualStart: new Date(actualStart),
      actualFinish: new Date(actualFinish),
      actualWork: actualWork,
      userComment: datedComment,
      saved: 1,
      leapComplete: completed,
      approvalStatus: "Saved, Awaiting Submission"
  });
  if(!save){
    console.log("Task data failed to save.");
    res.redirect('/profile?msg=failsave');
  } else{
    console.log("Task data saved successfully");
    res.redirect('/profile?msg=successsave');
  }
});

//UPDATE saved tasks by member before submission. 
router.post('/updatetask', isAuthenticated, async (req, res) => {
  let { actualFinish, actualWork, comment, completed, activityId } = req.body;
  comment = sanitizeUserComment(comment);
  const existingTask = await taskModel.findById(activityId);
  const existingWorkDone = existingTask.actualWork;
  const previousComment = existingTask.userComment || ""; // Get the existing comment or an empty string if none exists
  if(!actualFinish){
    actualFinish = existingTask.actualFinish;
  }
  // console.log(typeof completed);
  // if(completed === '100'){
  //   console.log(`completed value from the update task form has type`, typeof completed);
  //    actualFinish = new Date();
  // } //Allow the user to enter any date for finish date.
  const datedComment = "(" + new Date().toLocaleDateString('en-in') + ": " + actualWork + " Hrs) " + comment; 
  const newComment = previousComment + "; " + datedComment; // Concatenate the previous comment with the new dated comment

  try {
      //update consulting day if the task does not have that attribute.
      const updateConsultingDay = await taskModel.findOneAndUpdate(
        {
          _id: activityId, // Match the document by ID
          consultingDay: { $exists: false }, // Only update if consultingDay does not exist
        },
        {
          $set: { consultingDay: "Yes" }, // Set consultingDay to "Yes"
        },
        {
          new: true, // Return the updated document
        }
      );
      const update = await taskModel.findByIdAndUpdate(activityId, {
          actualFinish: new Date(actualFinish),
          actualWork: Number(existingWorkDone) + Number(actualWork),
          userComment: newComment,
          leapComplete: completed,
      });
      if(!update){
        console.log("Failed to update Task data.");
        res.redirect('/profile?msg=failupdate');
      } else{
        console.log("Task data updated successfully!");
        res.redirect('/profile?msg=successupdate');
      }     
  } catch (error) {
      console.log(error.message);
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
      const tasks = await taskModel.find({ resourceName: member.resourceName, submitted: 1, consultingDay: 'Yes' });
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
router.post('/submitToManager', isAuthenticated, async (req, res) => {
  try {
    const user = req.session.user; // Authentication check and can get the logged-in user's ID

    // Update tasks with consultingDay = Yes
    const updateYes = {
      submitted: 1,
      approvalStatus: "Submitted. Awaiting Approval"
    };
    await taskModel.updateMany({ resourceName: user.name, saved: 1, submitted: 0, consultingDay: "Yes" }, updateYes);

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


router.post('/approve', isManager, async (req, res) => {
  try {
    const user = req.session.user;
    let approved = 0;
    let reassigned = 0;
    const { resourceName } = req.body;
    // console.log("/approve is running. Resource name is: ", resourceName);

    const tasks = await taskModel.find({ resourceName: resourceName, submitted: 1, consultingDay: "Yes" });
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
router.post('/reassign', isManager, async (req, res) => {
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
router.get('/escalation', isManager,  async (req, res, next) => {
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
        { source: "MTE", approvalStatus: "Approved" }
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

// Route to show reports for resources hours for projects.
router.get('/resourcereport', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const user = req.session.user;

    // Check if the user is an Admin
    const resource = await resourceModel.findOne({ resourceName: user.name });
    const isAdmin = resource && resource.resourceRole === 'Admin';

    // Get the search term, selected resource name, and time period from the query parameters
    const searchTerm = req.query.search || '';
    const selectedResourceName = req.query.resourceName || '';
    const timePeriod = req.query.timePeriod || 'currentMonth'; // Default to current month

    // If no search term or resource name is provided, render the search form
    if (!searchTerm && !selectedResourceName) {
      return res.render('reports', {
        projectNames: [],
        billableHours: [],
        nonBillableHours: [],
        searchResults: [],
        isAdmin,
        searchTerm,
        selectedResourceName,
        timePeriod,
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
        return res.render('reports', {
          projectNames: [],
          billableHours: [],
          nonBillableHours: [],
          searchResults,
          isAdmin,
          searchTerm,
          selectedResourceName: '', // Clear selectedResourceName when showing search results
          timePeriod,
        });
      }
    }

    // If a resource is selected, fetch tasks for that resource within the selected time period
    let projectNames = [];
    let billableHours = [];
    let nonBillableHours = [];
    if (selectedResourceName) {
      // Determine the date range based on the selected time period
      let startDate, endDate;
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
        case 'lastYear':
          startDate = new Date(today.getFullYear() - 1, 0, 1);
          endDate = new Date(today.getFullYear() - 1, 11, 31);
          break;
        case 'allTime':
          startDate = new Date(0); // Earliest possible date
          endDate = new Date(); // Current date
          break;
        case 'currentMonth':
        default:
          startDate = new Date(today.getFullYear(), today.getMonth(), 1);
          endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          break;
      }

      // Fetch tasks for the selected resource within the date range
      const tasks = await taskModel.find({
        resourceName: selectedResourceName,
        start: { $gte: startDate },
        Finish: { $lte: endDate },
      });

      // Group tasks by projectName and calculate billable and non-billable hours
      const groupedData = tasks.reduce((acc, task) => {
        if (!acc[task.projectName]) {
          acc[task.projectName] = { billable: 0, nonBillable: 0 };
        }

        if (task.consultingDay === 'Yes' && task.source === 'PWA') {
          acc[task.projectName].billable += task.actualWork || 0;
        } else if (task.consultingDay === 'No' || task.source === 'MTE') {
          acc[task.projectName].nonBillable += task.actualWork || 0;
        }

        return acc;
      }, {});

      // Prepare data for the chart
      projectNames = Object.keys(groupedData);
      billableHours = projectNames.map(project => groupedData[project].billable);
      nonBillableHours = projectNames.map(project => groupedData[project].nonBillable);
    }

    // Render the chart view
    res.render('reports', {
      projectNames,
      billableHours,
      nonBillableHours,
      searchResults: [],
      isAdmin,
      searchTerm,
      selectedResourceName,
      timePeriod,
    });
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).send('An error occurred while generating the report.');
  }
});



module.exports = router;
