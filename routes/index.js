var express = require("express");
var router = express.Router();
const session = require("express-session");
const taskModel = require("./task");
const activityModel = require("./activity");
const resourceModel = require("./resource");
require("dotenv").config();
const mongoose = require("mongoose");
const axios = require("axios");
const msal = require("../authconfig");
const qs = require("qs");

// function to check user is logged in with MSAL Auth flow
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    // console.log("User is logged in, calling next");
    return next();
  } else {
    req.session.originalUrl = req.originalUrl; // Store the original URL
    // console.log(
    //   "User Not logged in, stored url and redirecting to /login, stored usl is: ",
    //   req.session.originalUrl
    // );
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

/* GET home page. */
router.get('/', async (req, res) => {
  try {
        res.render('index');
  } catch (error) {
    res.status(500).json({ message: 'Error Loggin in to app.', error: error.message });
  }
});

//GET HOME
router.get("/home", isAuthenticated, async (req, res) => {
  const currentWeekNumber = getWeekNumber(new Date());
  const currentYear = new Date().getFullYear(); // to be used for filter as later the we will have same week number for current year and next year
  const sessions = await activityModel
    .find({
      status: "On Going",
      activityType: "Rollouts",
      weekNumber: currentWeekNumber,
      year: currentYear,
    })
    .sort({ startDate: 1 });
    let msg = "";
  res.render("home", { sessions, msg });
});

//admin page
router.get("/admin", isAdmin, async (req, res) => {
  const user = req.session.user;
  // console.log("logged in user to /admin page is: ", user.name);
  const tasks = await taskModel.find();

  // Process data to get the count of tasks per projectName and their completion status
  const taskData = tasks.reduce((acc, task) => {
    if (!acc[task.projectName]) {
      acc[task.projectName] = { count: 0, complete: 0, incomplete: 0 };
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

  res.render("admin", { projectNames, taskCounts, taskCompleteCounts, taskIncompleteCounts });
});


// test automatic Escalations  route with server side logic to assign level of esc

router.get("/test", ensureEscalationAuth, async (req, res) => {
  let today = new Date();
  today.setHours(0, 0, 0, 0);
  const tasks = await activityModel
    .find({
      status: { $in: ["On Going", "On Hold", "Not Started"] },
      // const tasks = await activityModel.find({
      //     status: 'false',
      $expr: {
        $lt: [
          {
            $dateFromString: {
              dateString: {
                $concat: [
                  { $substr: ["$endDate", 6, 4] },
                  "-",
                  { $substr: ["$endDate", 3, 2] },
                  "-",
                  { $substr: ["$endDate", 0, 2] },
                ],
              },
              onError: null, // Handle invalid date strings
            },
          },
          today,
        ],
      },
    })
    .sort({ endDate: 1 });
  // console.log(tasks);
  // Convert Mongoose documents to plain JavaScript objects
  const plainTasks = tasks.map((task) => task.toObject());
  plainTasks.forEach((task, index) => {
    // console.log(`Processing task ${index + 1}:`, task);
    let endDateObj = new Date(task.endDate.split("/").reverse().join("-"));
    // console.log(`End date object for task ${index + 1}:`, endDateObj);

    if (today > endDateObj) {
      let diff = today - endDateObj;
      let delayInDays = Math.ceil(diff / (1000 * 60 * 60 * 24));
      task.delay = delayInDays;
      if (delayInDays > 0 && delayInDays < 4) {
        task.level = "Escalation Level 1";
      } else if (delayInDays >= 4 && delayInDays < 10) {
        task.level = "Escalation Level 2";
      } else {
        task.level = "Escalation Level 3";
      }
    } else {
      // console.log(`Task ${index + 1} is within deadline.`);
    }
  });
  // console.log("plaintasks array is:" )
  // console.log(plainTasks)
  plainTasks.sort((a, b) => a.delay - b.delay);
  res.render("test", { plainTasks });
});

// GET Timer page
router.get("/countdown", async (req, res) => {
  const currentWeekNumber = getWeekNumber(new Date());
  const currentYear = new Date().getFullYear(); // to be used for filter as later the we will have same week number for current year and next year
  const sessions = await activityModel
    .find({
      activityType: "Rollouts",
      weekNumber: currentWeekNumber,
      year: currentYear,
    })
    .sort({ startDate: 1 });

  res.render("countdown", { sessions });
});

// GET Escalations view page
router.get("/escview", async (req, res) => {
  const currentWeekNumber = getWeekNumber(new Date());
  const escalations = await escalationModel.find();
  updateStatusField();
  res.render("escview", { escalations });
});
// ALL ACtivities page
router.get("/allactivities", async function (req, res, next) {
try {  // const activities = await activityModel.find().sort({ startDate: -1 });
  const activities = await activityModel.aggregate([
    {
      $addFields: {
        startDateObj: {
          $cond: {
            if: {
              $or: [{ $eq: ["$startDate", "NA"] }, { $eq: ["$startDate", ""] }],
            },
            then: null,
            else: {
              $dateFromString: {
                dateString: "$startDate",
                format: "%d/%m/%Y",
              },
            },
          },
        },
      },
    },
    {
      $sort: {
        startDateObj: -1,
      },
    },
    {
      $project: {
        startDateObj: 0,
      },
    },
  ]);
  res.render("allactivities", { activities });
} catch(error) {
  console.log(error.message);
  next(error);
}
});

router.get("/auth", (req, res) => {
  const errorMessage =
    req.query.error === "invalid_code"
      ? "Invalid code! Please enter a valid code."
      : "";
  res.render("auth", { errorMessage });
});


// router to distinguis different code and session for authentication to access  activity admin and escalation section.
router.post("/auth", (req, res) => {
  const { code } = req.body;
  const validCodeA = process.env.VCA;
  const validCodeE = process.env.VCE;

  if (code === validCodeA) {
    req.session.isAuthenticated = true;
    req.session.authType = "activity";
    res.redirect("/createactivity");
  } else if (code === validCodeE) {
    req.session.isAuthenticated = true;
    req.session.authType = "escalation";
    res.redirect("/test");
  } else {
    res.redirect("/auth?error=invalid_code");
  }
});

router.get("/escadmin", async function (req, res, next) {
  const escalations = await escalationModel.find().sort({ updatedOn: -1 });
  const msg =
    req.query.msg === "successmsg" ? "New Escalation added successfully." : "";
  res.render("escadmin", { escalations, msg });
});

router.post("/escadmin", async (req, res) => {
  try {
    let errors = [];
    let msg;
    const escalations = await escalationModel.find();
    const { clientName, taskName, level, status, resource, remarks } = req.body;
    if (!clientName || !taskName || !resource) {
      errors.push({
        msg: "Please fill in all required fields: Client Name, Task Name and Resource.",
      });
    }
    if (errors.length > 0) {
      res.render("escadmin", {
        errors,
        clientName,
        taskName,
        level,
        resource,
        remarks,
        status,
        escalations,
        msg,
      });
    } else {
      const currentWeekNumber = getWeekNumber(new Date());
      const weekRange = getDateRangeForWeek(
        currentWeekNumber,
        new Date().getFullYear()
      );
      const startOfWeek = weekRange.startDate;
      const currentYear = new Date().getFullYear();

      //  console.log(currentWeekNumber);   // .dev
      //  console.log(startOfWeek);  /// .dev

      let weekNum = currentWeekNumber;
      // console.log(`the week number is ${weekNum}`);

      const newEscalation = new escalationModel({
        clientName,
        taskName,
        resource,
        level,
        remarks,
        status,
        year: currentYear,
        weekNumber: weekNum,
      });
      // console.log(newEscalation);
      await newEscalation.save(); //Holding save to check console before writing into DB UNCOMMENT THIS LINE WHEN DATETOUSE IS FIXED.
      // res.status(201).json(savedActivity);
      // req.flash(success: "new activity saved successfully")  //Connect-flash not installed yet. Using js alert for now
      res.redirect("/escadmin?msg=successmsg");
    }
  } catch (error) {
    res.status(500).json({ message: "error saving escalation", error });
  }
});


router.get("/createactivity", ensureActivityAuth,
  async function (req, res, next) {
    const search = req.query.search || "";
    // console.log(search);
    let activities;

    if (search) {
      // console.log("search term is availale, calling findrecords... function.");
      try {
        activities = await findRecordsByFields(search);
      } catch (error) {
        console.error("Error fetching activities:", error);
      }
      // console.log(activities.length);
    } else {
      activities = await activityModel.find().sort({ updatedOn: -1 });
    }
    let msg = "";
    if (req.query.msg === "successmsg") {
      msg = "New Activity added successfully.";
    } else if (req.query.msg === "updatesuccess") {
      msg = "Activity updated successfully.";
    } else if (req.query.msg === "deletesuccess") {
      msg = "Activity deleted successfully.";
    }
    // const msg =
    //   req.query.msg === "successmsg" ? "New Activity added successfully." : "";
    res.render("createactivity", { activities, msg, search });
  }
);

router.post("/createactivity", async (req, res) => {
  try {
    let errors = [];
    let msg;
    const activities = await activityModel.find().sort({ updatedOn: -1 });
    const {
      activityType,
      activityName,
      activityMode,
      startDate,
      startTime,
      endDate,
      endTime,
      year,
      resource,
      remarks,
    } = req.body;
    if (!activityType || !activityName || !resource) {
      errors.push({
        msg: "Please fill in all required fields: Activity Type, Activity Name and Resource.",
      });
    }
    if (errors.length > 0) {
      res.render("createactivity", {
        errors,
        activityType,
        activityName,
        activityMode,
        startDate,
        endDate,
        resource,
        remarks,
        activities,
        msg,
      });
    } else {
      // Set default values if fields are empty strings
      const startTime =
        req.body.startTime === "" ? "09:00" : req.body.startTime;
      const endTime = req.body.endTime === "" ? "17:00" : req.body.endTime;
      const activityMode =
        req.body.activityMode === "" ? "NA" : req.body.activityMode;
      const remarks = req.body.remarks === "" ? "NA" : req.body.remarks;

      const startDateValue =
        startDate && startDate.trim() !== "" ? startDate : "NA";
      const endDateValue = endDate && endDate.trim() !== "" ? endDate : "NA";

      const currentWeekNumber = getWeekNumber(new Date());
      const weekRange = getDateRangeForWeek(
        currentWeekNumber,
        new Date().getFullYear()
      );
      const startOfWeek = weekRange.startDate;

      //  console.log(currentWeekNumber);   // .dev
      //  console.log(startOfWeek);  /// .dev
      let dateToUse;
      // if (startDateValue !== "NA") {
      //   console.log(startDateValue);
      //   const [day, month, year] = startDate.split('/');
      //   dateToUse = new Date(Date.UTC(year, month - 1, day));
      // } else {
      //   dateToUse = new Date();
      // }
      if (startDateValue == "NA") {
        dateToUse = new Date();
      } else {
        const startDateObj = new Date(startDate.split("/").reverse().join("-"));
        // console.log(startDateObj);        /// .dev
        if (startDateObj < startOfWeek) {
          dateToUse = new Date();
        } else {
          dateToUse = startDateObj;
        }
      }
      // console.log(dateToUse);
      // const weekNumber = getWeekNumber(dateObject);
      let weekNum = getWeekNumber(dateToUse);
      // console.log(`the week number is ${weekNum}`);
      const year = new Date().getFullYear();
      let startDateTime = null;
      if (startDate && startTime) {
        startDateTime = convertToDateTime(startDate, startTime);
      }
      let endDateTime = null;
      if (endDate && endTime) {
        endDateTime = convertToDateTime(endDate, endTime);
      }
      const newActivity = new activityModel({
        activityType,
        activityName,
        startDate: startDateValue,
        startTime,
        startDateTime,
        endDate: endDateValue,
        endTime,
        endDateTime,
        year,
        resource,
        activityMode,
        remarks,
        weekNumber: weekNum,
      });
      // console.log(newActivity);
      await newActivity.save(); //Holding save to check console before writing into DB UNCOMMENT THIS LINE WHEN DATETOUSE IS FIXED.
      // res.status(201).json(savedActivity);
      // req.flash(success: "new activity saved successfully")  //Connect-flash not installed yet. Using js alert for now
      res.redirect("/createactivity?msg=successmsg");
    }
  } catch (error) {
    res.status(500).json({ message: "error saving activity", error });
  }
});

// router.post('/update/:id', async (req, res) => {
//   const { id } = req.params;
//   const updatedData = req.body;
//   updatedData.updatedOn = Date.now();
//   const { startDate, startTime, endDate, endTime } = updatedData;
//   let startDateTime = null;
//     if (startDate && startTime) {
//         startDateTime = convertToDateTime(startDate, startTime);
//     }
//     let endDateTime = null;
//     if (endDate && endTime) {
//         endDateTime = convertToDateTime(endDate, endTime);
//     }
//     let year;
//     if (startDate){
//       year = new Date(startDate).getFullYear();
//     }
//     updatedData.year = year
//   updatedData.startDateTime = startDateTime;
//   updatedData.endDateTime = endDateTime;
//   await activityModel.findByIdAndUpdate(id, updatedData);
//   res.redirect('/createactivity');
// });

// router.post("/update/:id", async (req, res) => {
//   const { id } = req.params;
//   const updatedData = req.body;
//   let startDateTime;
//   let endDateTime;

//   updatedData.updatedOn = Date.now();
//   // console.log(updatedData);
//   let model;
//   let year;
//   let weekNum;
//   model = activityModel;
//   const { startDate, endDate, startTime, endTime } = req.body;
//   if (startDate) {
//     year = new Date(startDate.split("/").reverse().join("-")).getFullYear();
//     weekNum = getWeekNumber(new Date(startDate.split("/").reverse().join("-")));
//   } else {
//     year = new Date().getFullYear();
//     weekNum = getWeekNumber(new Date());
//   }

//   if (startDate && startTime) {
//     // console.log("startDate and startTime exist");
//     startDateTime = convertToDateTime(startDate, startTime);
//   }
//   if (endDate && endTime) {
//     endDateTime = convertToDateTime(endDate, endTime);
//   }
//   updatedData.year = year;
//   updatedData.weekNumber = weekNum;
//   updatedData.startDateTime = startDateTime;
//   updatedData.endDateTime = endDateTime;

//   try {
//     await model.findByIdAndUpdate(id, updatedData);
//     res.redirect(req.headers["referer"]);
//   } catch (error) {
//     console.error("Error updating data:", error);
//     res.status(500).send("Internal Server Error");
//   }
// });

router.post("/update/:id", async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;
  let startDateTime;
  let endDateTime;

  updatedData.updatedOn = Date.now();

  const { startDate, endDate, startTime, endTime } = req.body;

  if (startDate) {
    const parsedStartDate = new Date(startDate.split("/").reverse().join("-"));
    updatedData.year = parsedStartDate.getFullYear();
    updatedData.weekNumber = getWeekNumber(parsedStartDate);
  } else {
    const currentDate = new Date();
    updatedData.year = currentDate.getFullYear();
    updatedData.weekNumber = getWeekNumber(currentDate);
  }

  if (startDate && startTime) {
    startDateTime = convertToDateTime(startDate, startTime);
  }
  if (endDate && endTime) {
    endDateTime = convertToDateTime(endDate, endTime);
  }

  updatedData.startDateTime = startDateTime;
  updatedData.endDateTime = endDateTime;

  try {
    await activityModel.findByIdAndUpdate(id, updatedData);
    res.redirect("/createactivity?msg=updatesuccess");
  } catch (error) {
    console.error("Error updating data:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Delete an item from the DB
router.post("/delete/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await activityModel.findByIdAndDelete(id);
    res.redirect("/createactivity?msg=deletesuccess");
  } catch (error) {
    console.error("Error deleting data:", error);
    res.status(500).send("Internal Server Error");
  }
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

function getDateRangeForWeek(weekNumber, year) {
  const firstDayOfYear = new Date(year, 0, 1);
  const firstMonday = new Date(
    firstDayOfYear.setDate(
      firstDayOfYear.getDate() + ((8 - firstDayOfYear.getDay()) % 7)
    )
  );
  const startDate = new Date(
    firstMonday.setDate(firstMonday.getDate() + (weekNumber - 1) * 7)
  );
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 5); // Saturday of the same week
    // Normalize to 00:00:00 hours
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
  return { startDate, endDate };
}

function getDateRangeForMonth() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { monthStart, monthEnd };
}

function ensureActivityAuth(req, res, next) {
  if (req.session.isAuthenticated && req.session.authType === "activity") {
    return next();
  } else {
    res.redirect("/auth?error=unauthorized");
  }
}

function ensureEscalationAuth(req, res, next) {
  if (req.session.isAuthenticated && req.session.authType === "escalation") {
    return next();
  } else {
    res.redirect("/auth?error=unauthorized");
  }
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
        { activityName: { $regex: searchTerm, $options: "i" } },
        { activityMode: { $regex: searchTerm, $options: "i" } },
        { resource: { $regex: searchTerm, $options: "i" } },
        { status: { $regex: searchTerm, $options: "i" } },
        { startDate: { $regex: searchTerm, $options: "i" } },
        { endDate: { $regex: searchTerm, $options: "i" } },
        { remarks: { $regex: searchTerm, $options: "i" } },
      ],
    };

    const records = await activityModel.find(query);
    return records;
  } catch (error) {
    console.error("Error finding records:", error);
  }
}


///////////////////////////////////////////////////MSAL and PWA routes here ////////////////////////////////////////////////////////

//start MSAL auth process to get auth code with pwa scope
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

//use auth code to get access Token
router.get("/oauth/redirect", async (req, res) => {
  const tokenRequest = {
    code: req.query.code,
    scopes: [process.env.S_SCOPE],
    redirectUri: process.env.REDIRECT_URI,
  };

  try {
    const response = await msal.acquireTokenByCode(tokenRequest);
    // console.log('API response JSON is: ', JSON.stringify(response, null, 2));
    req.session.user = response.account;
    req.session.token = response.accessToken;
    // console.log('session data req.session is: ', req.session);
    const redirectUrl = req.session.originalUrl || "/profile";
    delete req.session.originalUrl; // Clear the stored URL
    res.redirect(redirectUrl);
  } catch (error) {
    console.log(error);
    res.status(500).send(error);
  }
});

//profile page to land after access token authenticated also initialize resource MOdel if empty  /////////////////////////////////////////////////////////////////////////////////////////////////////////////
router.get("/profile", isAuthenticated, async (req, res, next) => {
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
                "User-Agent": "MyNodeApp",
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
  const { startDate, endDate } = getDateRangeForWeek(
    getWeekNumber(new Date()),
    new Date().getFullYear()
  );
  function formatDateToLocalISOString(date) {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0] + 'T00:00:00';
  }

const startDateString = formatDateToLocalISOString(startDate);
const endDateString = formatDateToLocalISOString(endDate);

  // const userTasks = await taskModel.find({resourceName: resourceName});
  const incompleteTasks = await taskModel.find({
    $and: [
        {
            $or: [
                { start: { $gte: startDateString, $lte: endDateString } }, // starts within current week
                { Finish: { $gte: startDateString, $lte: endDateString } }, // finishes within current week
                {
                    $and: [
                        { start: { $lt: startDateString } },
                        { Finish: { $gt: endDateString } }
                    ] // starts before current week and finishes after current week
                },
                {
                    $and: [
                        { Finish: { $lt: startDateString } },
                        { taskCompletePercent: { $lt: 100 } }
                    ] // finished before current week but still incomplete
                },
                {
                    $and: [
                        { start: { $gte: startDateString, $lte: endDateString } },
                        { taskCompletePercent: { $eq: 100 } }
                    ] // completed tasks that started within the week
                },
                {
                    $and: [
                        { Finish: { $gte: startDateString, $lte: endDateString } },
                        { taskCompletePercent: { $eq: 100 } }
                    ] // completed tasks that finished within the week
                },
                {
                  $and: [
                      { Finish: { $lt: startDateString } },
                      { taskCompletePercent: { $lt: 100 } },
                      { submitted: { $ne: 2 } }
                  ] // finished before current week, its completes but still not approved by manager
              }
            ]
        },
        { resourceName: resourceName }
    ]
}).sort({start: 1});


  // console.log('userTasks length is: ', userTasks.length);
  //  const incompleteTasks = userTasks.filter((task) => {
  //   return task.taskCompletePercent < 100;
  //  });
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
  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // console.log(`UserDetails are: ${resourceDetails}`);

  // try {
  //   // console.log('user account json is: ', user);
  //   // console.log('the access token is: ', accessToken);
  //   const projectapiresponse = await axios.get(
  //     "https://chrysalishrd.sharepoint.com/pwa/_api/ProjectData/Projects",
  //     {
  //       headers: {
  //         Authorization: `Bearer ${accessToken}`,
  //         Accept: "application/json",
  //         "User-Agent": "MyNodeApp",
  //       },
  //     }
  //   );
  //   const projects = projectapiresponse.data.value;
  //   const ongoingProjects = projects.filter(
  //     (project) => project.ProjectPercentCompleted < 100
  //   );
  //   console.log("number of ongoing Projects is: ", ongoingProjects.length);

  //   // Fetch assignments for each project
  //   const assignmentsPromises = ongoingProjects.map(async (project) => {
  //     const projectId = project.ProjectId;
  //     const assignmentsResponse = await axios.get(
  //       `https://chrysalishrd.sharepoint.com/pwa/_api/ProjectData/Projects(guid'${projectId}')/Assignments?$filter=ResourceName %20eq%20'${encodedName}'`,
  //       {
  //         headers: {
  //           Authorization: `Bearer ${accessToken}`,
  //           Accept: "application/json",
  //           "User-Agent": "MyNodeApp",
  //         },
  //       }
  //     );

  //     return assignmentsResponse.data.value;
  //   });
  //   const assignments = await Promise.all(assignmentsPromises);
  //   const allAssignments = assignments.flat();

  //   console.log(
  //     `Total assignments from ongoing projects for ${user.name} are: ${allAssignments.length}`
  //   );
  //   const incompleteAssignments = allAssignments.filter(
  //     (assignment) => assignment.AssignmentPercentWorkCompleted < 100
  //   );
  //   console.log(
  //     `The total number of incomplete Assignements for ${user.name} are: ${incompleteAssignments.length}`
  //   );
  //   res.render("profile", { user, incompleteAssignments, resourceDetails });
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
    const start = actualStart + "T00:00:00";
   
    let Finish;
    if(completed === '100'){
       Finish = new Date().toLocaleDateString('en-IN').split("/").reverse().map(part => part.padStart(2, '0')).join("-") + "T00:00:00";
    } else {
      Finish = actualFinish + "T00:00:00";
    }
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
        // console.log("saved the task successfully: ", taskName);
        // console.log(savedTask);
        // res.render('profile', {msg: "Task added successfully. Awaiting for Manager Approval."});
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
router.get("/pwaactivities", isAuthenticated, async(req, res, next) => {
  const { startDate, endDate } = getDateRangeForWeek(
    getWeekNumber(new Date()),
    new Date().getFullYear()
  );
  function formatDateToLocalISOString(date) {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0] + 'T00:00:00';
  }

const startDateString = formatDateToLocalISOString(startDate);
const endDateString = formatDateToLocalISOString(endDate);

const activities = await taskModel.find({
  $and: [
    {
      $or: [
        { start: { $gte: startDateString, $lte: endDateString } }, // starts within current week
        { Finish: { $gte: startDateString, $lte: endDateString } },  //Finishes within current week
        {
          $and: [
            { start: { $lt: startDateString } },
            { Finish: { $gt: endDateString } }
          ]  // such task start before current week and will finish after current week.
        },
        {       $and: [{Finish: { $lt: startDateString }, taskCompletePercent: {$lt: 100}}]         }  // Task has finish date in past week but its still incomplete
      ]
    },
    { source: "PWA" }
  ]  
}).sort({ typeofActivity: -1 });  //returns activities with start/finish between current weekor activity that either starts or finish in current week.

  // Group activities by typeofActivity
  const groupedActivities = activities.reduce((acc, activity) => {
    if (!acc[activity.typeofActivity]) {
      acc[activity.typeofActivity] = [];
    }
    acc[activity.typeofActivity].push(activity);
    return acc;
  }, {});
  console.log("length of activities is: ", activities.length);
  res.render('pwaactivities', {groupedActivities, startDate, endDate} );
});

// route to render monthly plan for viewers
router.get("/monthlyplan", isAuthenticated, async(req, res) => {
  const { startDate, endDate } = getDateRangeForWeek(
    getWeekNumber(new Date()),
    new Date().getFullYear()
  );
  const {monthStart, monthEnd} = getDateRangeForMonth();

  function formatDateToLocalISOString(date) {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0] + 'T00:00:00';
  }

const startDateString = formatDateToLocalISOString(monthStart);
const endDateString = formatDateToLocalISOString(monthEnd);

// console.log('startDateString is: ', startDateString);
// console.log("enddateStrin is:",endDateString );
const activities = await taskModel.find({
  $and: [
    {
      $or: [
        { start: { $gte: startDateString, $lte: endDateString } }, // starts within current week
        { Finish: { $gte: startDateString, $lte: endDateString } },  //Finishes within current week
        {
          $and: [
            { start: { $lt: startDateString } },
            { Finish: { $gt: endDateString } }
          ]  // such task start before current week and will finish after current week.
        },
        {       $and: [{Finish: { $lt: startDateString }, taskCompletePercent: {$lt: 100}}]         }  // Task has finish date in past week but its still incomplete
      ]
    },
    { source: "PWA" }
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
  // console.log("length of activities is: ", activities.length);
  res.render('monthlyplan', {groupedActivities, monthStart, monthEnd} );
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
                  "User-Agent": "MyNodeApp",
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
          "User-Agent": "MyNodeApp",
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
            "User-Agent": "MyNodeApp",
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
              "User-Agent": "MyNodeApp",
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
          existingTask.taskIsActive = task.TaskIsActive
          await existingTask.save();
        } else {
          // Insert new task
          const newTask = new taskModel({
            projectId: task.ProjectId,
            projectName: task.ProjectName,
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
          const { ProjectId, ClientName, InterventionName } = project;
          await taskModel.updateMany(
            { projectId: ProjectId },
            {
              $set: {
                clientName: ClientName,
                interventionName: InterventionName,
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
                  "User-Agent": "MyNodeApp",
                },
              }
            );
            const allprojects = projectAPIresponse.data.value;
            // console.log(
            //   `The number of Projects in the total, from projects api response are: ${allprojects.length}`
            // );
            // console.log('All Projects  that is projectapiresponse.data.value is: ', allprojects);
            const ongoingProjects = allprojects.filter(
              (project) => project.ProjectPercentCompleted < 100
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
                                    "User-Agent": "MyNodeApp",
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
                    "User-Agent": "MyNodeApp",
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
  if(completed === '100'){
    actualFinish = new Date().toLocaleDateString('en-IN').split("/").reverse().map(part => part.padStart(2, '0')).join("-") + "T00:00:00";
  }
  // save the activity in the database
  const save = await taskModel.findByIdAndUpdate(activityId, {
      actualStart: actualStart + "T00:00:00",
      actualFinish: actualFinish,
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
  const {  actualWork, comment, completed, activityId } = req.body;
  

  const existingTask = await taskModel.findById(activityId);
  const existingWorkDone = existingTask.actualWork;
  const previousComment = existingTask.userComment || ""; // Get the existing comment or an empty string if none exists
  let actualFinish = existingTask.actualFinish;
  console.log(typeof completed);
  if(completed === '100'){
     actualFinish = new Date().toLocaleDateString('en-IN').split("/").reverse().map(part => part.padStart(2, '0')).join("-") + "T00:00:00";
  }
  const datedComment = "(" + new Date().toLocaleDateString('en-in') + ": " + actualWork + " Hrs) " + comment; 
  const newComment = previousComment + "; " + datedComment; // Concatenate the previous comment with the new dated comment

  try {
      const update = await taskModel.findByIdAndUpdate(activityId, {
          actualFinish: actualFinish,
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
router.get('/escalation', isManager, async (req, res, next) => {
  try {
    const user = req.session.user;
    const today = new Date().toISOString().split('T')[0] + "T00:00:00";
    const tasks = await taskModel.find({
      Finish: { $lt: today },
      taskCompletePercent: { $lt: 100 },
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
      res.render('escalation', {plainTasks: tasks});
  } catch (error) {
    console.log(error.message);
    next(error);
  }
});

module.exports = router;
