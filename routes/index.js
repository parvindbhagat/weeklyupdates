var express = require("express");
var router = express.Router();
const session = require("express-session");
const taskModel = require("./task");
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
            res.status(403).send('User is not a member of the FTE or PTE group');
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
        res.status(500).send(`Failed to verify group membership.  You can log in then try again. If you are a member of Xtended team, please visit :  ${process.env.PTE_URL}`);
    }
}
//check referrer to allow only from the chrd site
function checkReferrer(req, res, next) {
  const referrer = req.get('Referrer') || req.get('Referer'); // Some browsers use 'Referer' instead of 'Referrer'
  const allowedDomains = [
      /\.example\.com\/.*/,
      /\.anotherexample\.com\/.*/,
      /\.yetanotherexample\.com\/.*/
  ];

  if (referrer && allowedDomains.some(domain => domain.test(referrer))) {
      return next();
  } else {
      res.status(403).send('Invalid access, please visit example.com to log in');
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
    dateValue.split("/").reverse().join("-") + "T" + timeValue + ":00";
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
    ]
}).sort({start: 1});

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

   res.render('profile', {user, incompleteTasks, resourceDetails, startDate, endDate, msg});  //  Actual data to be passed to view for usrs view.
  
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
    const {projectName, taskName, actualStart, actualFinish, actualWork, userComment, completed} = req.body;
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
router.get("/pwaactivities", isAuthenticated, isFTE,  async (req, res, next) => {
  const { startDate, endDate } = getCurrentWeekDateRange();
  // console.log('startdate of week is of type', typeof startDate);

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
}).sort({ typeofActivity: -1 });  //returns activities with start/finish between current week or activity that either starts or finish in current week.

const projectsOnHold = await taskModel.distinct('projectName', { ProjectStatus: "On Hold" });
  // Group activities by typeofActivity
  const groupedActivities = activities.reduce((acc, activity) => {
    if (!acc[activity.typeofActivity]) {
      acc[activity.typeofActivity] = [];
    }
    acc[activity.typeofActivity].push(activity);
    return acc;
  }, {});
  console.log("length of activities is: ", activities.length);
  res.render('pwaactivities', {groupedActivities, projectsOnHold, startDate, endDate} );
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
    res.render('/', {sessions, msg: "Please login to proceed with the action."});
  }
  try {
    const result = await resourceModel.deleteMany({});
    // console.log(`Deleted ${result.deletedCount} documents from the resourceModel collection.`);
  } catch (error) {
    console.error('Error deleting documents:', error);
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

    await initializeResources();
    res.redirect('/resourcelist');


});

// REFRESH DATABASE TASKS BY ADMIN  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
router.get("/refreshdatabase", isAdmin, async (req, res) => {
  const accessToken = req.session.token;
  const user = req.session.user;
  let sessions = [];
  if(!user || !accessToken){
    console.log("Either User or Access Token is missing.");
    res.render('/', {sessions, msg: "Please login to proceed with the action."});
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
    if (!Array.isArray(allprojects)) {
      // console.log("allproject is not an array, converting it to array.");
      allprojects = [allprojects];
    } else{
      // console.log("allprojects is  an array.");
    }
    // console.log("type of allprojects is: ", allprojects);
    //get data from Tasks API
    const tasksPromises = allprojects.map(async (project) => {
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
  
    const assignmentsPromises = allprojects.map(
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
  
    return { projects: allprojects, tasks: leapTasks, resources: allassignments  }; 
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
            interventionName: task.InterventionName
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
router.get("/alltasks", isAdmin, async (req, res) => {
  try {
    //fuction to add clientName and InterventionName to each task with matching projectId
    async function updateTaskClients(projects) {
      try {
        for (const project of projects) {
          const { ProjectId, ClientName, InterventionName, ProjectPercentWorkCompleted, ProjectStatus } = project;
          await taskModel.updateMany(
            { projectId: ProjectId },
            {
              $set: {
                clientName: ClientName,
                interventionName: InterventionName,
                ProjectStatus: ProjectStatus,
                ProjectPercentWorkCompleted: ProjectPercentWorkCompleted,
              },
            }
          );
          // console.log(`Updated tasks for project: ${ProjectName}`);
        }
      } catch (error) {
        console.error("Error updating tasks:", error);
      }
    }

    //function to add assigned resourceName and resourceId to each task with matching taskId in the assignment API response.
    async function updateTaskResources(assignments) {
      try {
        const tasks = await taskModel.find({});

        for (const task of tasks) {
          const assignment = assignments.find((a) => a.TaskId === task.taskId);
          if (assignment) {
            await taskModel.updateOne(
              { taskId: task.taskId },
              {
                $set: {
                  resourceId: assignment.ResourceId,
                  resourceName: assignment.ResourceName,
                },
              }
            );
            // console.log(
            //   `Updated taskId: ${task.taskId} with resourceId: ${assignment.ResourceId} and resourceName: ${assignment.ResourceName}`
            // );
          }
        }
      } catch (error) {
        console.error("Error updating tasks:", error);
      }
    }
    //function to initialize tasks data if task collection is empty
    async function initializeTasks() {
      try {
        const count = await taskModel.countDocuments();
        if (count === 0) {
          console.log("Task collection is empty. Adding Tasks...");

          const accessToken = req.session.token;
          if (!accessToken) {
            console.log("access token mission. could not fetch tasks data.");
          } else {
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
            // console.log(
            //   `The number of Projects in the total, from projects api response are: ${allprojects.length}`
            // );
            // console.log('All Projects  that is projectapiresponse.data.value is: ', allprojects);
            const ongoingProjects = allprojects.filter(
              (project) => project.ProjectPercentWorkCompleted < 100
            );
            // console.log(
            //   "The length of ongoing projects list is: ",
            //   ongoingProjects.length
            // );
                          // Fetch assignments for each project ===================================
                          const assignmentsPromises = ongoingProjects.map(
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
                          const allAssignments = assignments.flat();
                          console.log('Length of all Assignements is : ', allAssignments.length);

            // get tasks from all the ongoing projects ========================
            const tasksPromises = ongoingProjects.map(async (project) => {
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
              // console.log(
              //   "Length of response.data.value for all tasks from Ongoing projects is: ",
              //   tasksResponse.data.value.length
              // );
              return tasksResponse.data.value;
            });
            const taskarray = await Promise.all(tasksPromises);
            const alltasks = taskarray.flat();
            console.log(
              "taskarray after promise.all length is: ",
              alltasks.length
            );
            const activeTasks = alltasks.filter(
              (task) => task.TaskIsActive === true
            );
            const leapTasks = activeTasks.filter(
              (task) =>
                (task.LEAPApplicationSync === "Yes" ||
                  task.LEAPApplicationSync === "yes") &&
                task.TaskPercentWorkCompleted < 100
            );
            console.log("the length of leap tasks is: ", leapTasks.length);
            /////////////////// return tasks to check nesting
            // return leapTasks;
            // const alltasks = tasks[0].task;
            // console.log("length of alltasks array is: ", alltasks.length);
            // console.log("fist task in the list is: ", alltasks[0]);
            //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
            for (const taskData of leapTasks) {
              const {
                ProjectId,
                ProjectName,
                TaskId,
                TaskName,
                ParentTaskName,
                TaskStartDate,
                TaskFinishDate,
                TaskWork,
                TypeofActivity,
                TaskPercentWorkCompleted,
                LEAPApplicationSync,
                TaskIsActive
              } = taskData;
              
              const source = "PWA";
              const task = new taskModel({
                projectId: ProjectId,
                projectName: ProjectName,
                ProjectPercentWorkCompleted: ProjectPercentWorkCompleted,
                ProjectStatus: ProjectStatus,
                taskId: TaskId,
                taskName: TaskName,
                parentTaskName: ParentTaskName,
                start: TaskStartDate,
                Finish: TaskFinishDate,
                taskWork: TaskWork,
                typeofActivity: TypeofActivity,
                taskCompletePercent: TaskPercentWorkCompleted,
                LeapSync: LEAPApplicationSync,
                source: source,
                taskIsActive: TaskIsActive
              });
              // console.log(`The task data is: ${task} `);
              try {
                await task.save();
                // console.log(`saved task: ${TaskName}`);
              } catch (error) {
                console.error(`Error saving task: ${TaskName}`, error);
              }
            }
            updateTaskClients(ongoingProjects);
            updateTaskResources(allAssignments);
          }
          //Once the colection is initialized fill resource details from resource api
          //setResource();  //// SetResource function should add resource name and id from the assignement api for task id.
        } else {
          console.log("Resource collection is not empty. No action taken.");
        }
      } catch (err) {
        console.error("Error checking resource collection", err);
      }
    }
    const user = req.session.user;
    // console.log('user details are: ', user);
    const userName = user.name;
    const resource = await resourceModel.findOne({ resourceName: userName });
    if (resource) {
      if (resource.resourceRole === "Admin") {
        console.log("Admin logged in", userName);
        initializeTasks();
        const tasks = await taskModel.find().sort({projectName: 1});
        console.log("rendering incomplete tasks from DB and length is: ", tasks.length);
        res.render("alltasks", { tasks });
      } else {
        console.log("Member logged in: ", userName);
        res.redirect("/profile");
      }
    } else {
      res.redirect("/profile");
    }
  } catch (error) {
    console.error("Error fetching resource:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Save task in the database and then it can be updated or submitted to manager for approval
router.post('/savetask', isAuthenticated, async (req, res) => {
  let { activityId, actualStart, actualFinish, actualWork, comment, completed } = req.body;
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
      const tasks = await taskModel.find({ resourceName: member.resourceName, submitted: 1 });
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

// Submit to Manager route to submit user tasks to manager for approval////////////////////////////////////////////////////////////////////////////////////////////////
router.post('/submitToManager', isAuthenticated, async (req, res) => {
  try {
    const user = req.session.user; //Athentication check and can get the logged-in user's ID
    const update = { submitted: 1,
                    approvalStatus: "Submitted. Awaiting Approval"
     };

    // Update all objects for the logged-in user
    const result = await taskModel.updateMany({ resourceName: user.name, saved: 1, submitted: 0 }, update);

    res.json({ success: true, message: 'All items submitted successfully!' });
  } catch (err) {
    res.json({ success: false, message: 'Failed to submit items.' });
  }
});


router.post('/approve', isManager, async (req, res) => {
  try {
    const user = req.session.user;
    let approved = 0;
    let reassigned = 0;
    const { resourceName } = req.body;
    // console.log("/approve is running. Resource name is: ", resourceName);

    const tasks = await taskModel.find({ resourceName: resourceName, submitted: 1 });
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

module.exports = router;
