var express = require('express');
var router = express.Router();
const session = require('express-session');
const escalationModel = require('./escalation');
const activityModel= require('./activity');
require('dotenv').config();


/* GET home page. */
router.get('/', async (req, res) => {
  try {
    const { startDate, endDate } = getDateRangeForWeek(getWeekNumber(new Date()), new Date().getFullYear());
    const activities = await activityModel.find({ weekNumber: getWeekNumber(new Date()) }).sort({startDate: 1});

    // Group activities by activityType
    const groupedActivities = activities.reduce((acc, activity) => {
      if (!acc[activity.activityType]) {
        acc[activity.activityType] = [];
      }
      acc[activity.activityType].push(activity);
      return acc;
    }, {});
    // console.log('Grouped Activities:', groupedActivities)

    res.render('index', { groupedActivities, startDate, endDate });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching activities', error: error.message });
  }
});

//GET HOME
router.get('/home', (req, res) => {
  res.render('home');
});

router.get('/activities', async (req, res) => {
  try {
    const { startDate, endDate } = getDateRangeForWeek(getWeekNumber(new Date()), new Date().getFullYear());
    const activities = await activityModel.find({ weekNumber: getWeekNumber(new Date()), year: new Date().getFullYear() }).sort({startDate: 1});

    // Group activities by activityType
    const groupedActivities = activities.reduce((acc, activity) => {
      if (!acc[activity.activityType]) {
        acc[activity.activityType] = [];
      }
      acc[activity.activityType].push(activity);
      return acc;
    }, {});
    // console.log('Grouped Activities:', groupedActivities)

    res.render('activities', { groupedActivities, startDate, endDate });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching activities', error: error.message });
  }
});

// test automatic Escalations  route with server side logic to assign level of esc

router.get('/test', ensureEscalationAuth, async (req, res) => {
  let today = new Date();

  // Function to validate date string in 'dd/mm/yyyy' format
  function isUkDate(dateString) {
      const regex = /^\d{2}\/\d{2}\/\d{4}$/;
      return regex.test(dateString);
  }

  // Find tasks with valid endDate and status 'false'
  const tasks = await activityModel.find({
      status: 'false',
      $expr: {
          $lt: [
              {
                  $dateFromString: {
                      dateString: {
                          $concat: [
                              { $substr: ["$endDate", 6, 4] }, "-",
                              { $substr: ["$endDate", 3, 2] }, "-",
                              { $substr: ["$endDate", 0, 2] }
                          ]
                      },
                      onError: null // Handle invalid date strings
                  }
              },
              today
          ]
      }
  }).sort({endDate: 1});

  // Convert Mongoose documents to plain JavaScript objects
  const plainTasks = tasks.map(task => task.toObject());
  plainTasks.forEach((task, index) => {
      // console.log(`Processing task ${index + 1}:`, task);
      let endDateObj = new Date(task.endDate.split("/").reverse().join("-"));
      // console.log(`End date object for task ${index + 1}:`, endDateObj);

      if (today > endDateObj) {
          let diff = today - endDateObj;
          let delayInDays = Math.ceil(diff / (1000 * 60 * 60 * 24));
            task.delay = delayInDays;
          if (delayInDays > 0 && delayInDays < 4) {
              task.level = '0-3';
          } else if (delayInDays >= 4 && delayInDays < 10) {
              task.level = '4-10';
          } else {
              task.level = '>10';
          }
      } else {
          // console.log(`Task ${index + 1} is within deadline.`);
      }
  });
  plainTasks.sort((a, b) => a.delay - b.delay);
  res.render('test', { plainTasks });
});


// GET Timer page
router.get('/countdown', async (req, res) => {
  const currentWeekNumber = getWeekNumber(new Date());  
  const currentYear = new Date().getFullYear();  // to be used for filter as later the we will have same week number for current year and next year
  const sessions = await activityModel.find({activityType: 'Rollouts', weekNumber: currentWeekNumber, year: currentYear}).sort({ startDate: 1 });      
  
  res.render('countdown', {sessions});
});

// GET Escalations view page
router.get('/escview', ensureEscalationAuth,  async (req, res) => {
  const currentWeekNumber = getWeekNumber(new Date());
  const escalations = await escalationModel.find();
  res.render('escview', {escalations});
});
// ALL ACtivities page
router.get('/allactivities', async function(req, res, next) {
  const activities = await activityModel.find().sort({ updatedOn: -1 });
  res.render('allactivities', { activities });
});


router.get('/auth', (req, res) => {
  const errorMessage = req.query.error === 'invalid_code' ? 'Invalid code! Please enter a valid code.' : '';
  res.render('auth', { errorMessage });
});

// router.post('/auth', (req, res) => {
//   const { code } = req.body;
//   const validCodeA = process.env.VCA; 
//   const validCodeE = process.env.VCE

//   if (code === validCodeA) {
//       req.session.isAuthenticated = true;
//       res.redirect('/createactivity');
//   } else if (code === validCodeE) {
//       req.session.isAuthenticated = true;
//       res.redirect('/escview');
//   }   else {
//       res.redirect('/auth?error=invalid_code');
//   }
// });

//updated router to distinguis different code and session for authentication to access  activity admin and escalation section. 
router.post('/auth', (req, res) => {
  const { code } = req.body;
  const validCodeA = process.env.VCA; 
  const validCodeE = process.env.VCE;

  if (code === validCodeA) {
    req.session.isAuthenticated = true;
    req.session.authType = 'activity';
    res.redirect('/createactivity');
  } else if (code === validCodeE) {
    req.session.isAuthenticated = true;
    req.session.authType = 'escalation';
    res.redirect('/test');
  } else {
    res.redirect('/auth?error=invalid_code');
  }
});

router.get('/escadmin', ensureEscalationAuth, async function(req, res, next) {
  const escalations = await escalationModel.find().sort({ updatedOn: -1 });
  const msg = req.query.msg === 'successmsg' ? 'New Escalation added successfully.' : '';
  res.render('escadmin', { escalations, msg });
});


router.post('/escadmin', async (req, res) => {
  
  try {
    let errors = []; 
    let msg;
    const escalations = await escalationModel.find();
    const {clientName, taskName, level, status, resource, remarks} = req.body;
    if (!clientName || !taskName || !resource ) {
      errors.push({ msg: "Please fill in all required fields: Client Name, Task Name and Resource." });
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
        msg
      });
    } else{
       
    const currentWeekNumber = getWeekNumber(new Date());
    const weekRange = getDateRangeForWeek(currentWeekNumber, new Date().getFullYear());
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
      weekNumber: weekNum
      });
    // console.log(newEscalation);
    await newEscalation.save();    //Holding save to check console before writing into DB UNCOMMENT THIS LINE WHEN DATETOUSE IS FIXED.
    // res.status(201).json(savedActivity);
    // req.flash(success: "new activity saved successfully")  //Connect-flash not installed yet. Using js alert for now
        res.redirect('/escadmin?msg=successmsg');
  }
  } catch (error) {
    res.status(500).json({message: "error saving escalation", error});
  }
});

router.get('/createactivity', ensureActivityAuth, async function(req, res, next) {
  const activities = await activityModel.find().sort({ updatedOn: -1 });
  const msg = req.query.msg === 'successmsg' ? 'New Activity added successfully.' : '';
  res.render('createactivity', { activities, msg });
});

router.post('/createactivity', async (req, res) => {
  
  try {
    let errors = []; 
    let msg;
    const activities = await activityModel.find().sort({ updatedOn: -1 });
    const {activityType, activityName, activityMode, startDate, startTime, endDate, endTime, year, resource, remarks} = req.body;
    if (!activityType || !activityName || !resource ) {
      errors.push({ msg: "Please fill in all required fields: Activity Type, Activity Name and Resource." });
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
        msg
      });
    } else{

    
    const startDateValue = startDate && startDate.trim() !== "" ? startDate : "NA";
    const endDateValue = endDate && endDate.trim() !== "" ? endDate : "NA";

    const currentWeekNumber = getWeekNumber(new Date());
    const weekRange = getDateRangeForWeek(currentWeekNumber, new Date().getFullYear());
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
    if (startDateValue == "NA"){
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
      weekNumber: weekNum
      });
    // console.log(newActivity);
    await newActivity.save();    //Holding save to check console before writing into DB UNCOMMENT THIS LINE WHEN DATETOUSE IS FIXED.
    // res.status(201).json(savedActivity);
    // req.flash(success: "new activity saved successfully")  //Connect-flash not installed yet. Using js alert for now
        res.redirect('/createactivity?msg=successmsg');
  }
  } catch (error) {
    res.status(500).json({message: "error saving activity", error});
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

router.post('/update/:id', async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;
  updatedData.updatedOn = Date.now();
  // console.log(updatedData);
  let model;
  let year;
  let weekNum;
  if (req.headers['referer'].includes('/createactivity')) {
    model = activityModel;
    const {startDate, endDate, startTime, endTime} = req.body;
    if( startDate) {
     year = new Date(startDate.split("/").reverse().join("-")).getFullYear();
     weekNum = getWeekNumber(new Date(startDate.split("/").reverse().join("-")));
    } else {
      year = new Date().getFullYear();
      weekNum = getWeekNumber(new Date());
    }
    
    if (startDate && startTime){
      startDateTime = convertToDateTime(startDate, startTime);
    }
    if (endDate && endTime){
      endDateTime = convertToDateTime(endDate, endTime);
    }
    updatedData.year = year;
    updatedData.weekNumber = weekNum;
    // if (startDateTime) {
    //   updatedData.startDateTime = new Date(startDateTime);
    // }

    // if (endDateTime) {
    //   updatedData.endDateTime = new Date(endDateTime);
    // }
    
    
    // console.log(updatedData);
     //Update LOGIC and Calculations here//
  } else if (req.headers['referer'].includes('/escadmin')) {
    model = escalationModel;
    weekNum = getWeekNumber(new Date());
    updatedData.weekNumber = weekNum;
    // console.log(updatedData);
  } else {
    return res.status(400).send('Invalid request source');
  }

  try {
    await model.findByIdAndUpdate(id, updatedData);
    res.redirect(req.headers['referer']);
  } catch (error) {
    console.error('Error updating data:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/delete/:id', async (req, res) => {
  const { id } = req.params;

  let model;
  // console.log('Referer:', req.headers['referer']);

  if (req.headers['referer'].includes('/createactivity')) {
    model = activityModel;
  } else if (req.headers['referer'].includes('/escadmin')) {
    model = escalationModel;
  } else {
    return res.status(400).send('Invalid request source');
  }

  try {
    // console.log(id, model);
    await model.findByIdAndDelete(id);
    res.redirect(req.headers['referer']);
  } catch (error) {
    // console.log(id);
    // console.log(model);
    console.error('Error deleting data:', error);
    res.status(500).send('Internal Server Error');
  }
});

function getWeekNumber(date) {
  const target = new Date(date.valueOf());
  const dayNumber = (date.getUTCDay() + 6) % 7; // Get day number (Monday = 0, Sunday = 6)
  target.setUTCDate(target.getUTCDate() - dayNumber + 3); // Set target to nearest Thursday
  const firstThursday = new Date(target.getUTCFullYear(), 0, 4); // Get first Thursday of the year
  const weekNumber = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + (firstThursday.getUTCDay() + 6) % 7) / 7);
  return weekNumber;
}

function getDateRangeForWeek(weekNumber, year) {
  const firstDayOfYear = new Date(year, 0, 1);
  const firstMonday = new Date(firstDayOfYear.setDate(firstDayOfYear.getDate() + (8 - firstDayOfYear.getDay()) % 7));
  const startDate = new Date(firstMonday.setDate(firstMonday.getDate() + (weekNumber - 1) * 7));
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 4); // Friday of the same week
  return { startDate, endDate };
}

function ensureActivityAuth(req, res, next) {
  if (req.session.isAuthenticated && req.session.authType === 'activity') {
    return next();
  } else {
    res.redirect('/auth?error=unauthorized');
  }
};

function ensureEscalationAuth(req, res, next) {
  if (req.session.isAuthenticated && req.session.authType === 'escalation') {
    return next();
  } else {
    res.redirect('/auth?error=unauthorized');
  }
};

// combie date and Time  to return DateTime object for mathematical operations
function convertToDateTime(dateValue, timeValue) {
  const dateTimeString = dateValue.split("/").reverse().join("-") + "T" + timeValue + ":00";  
  return new Date(dateTimeString);
}

 // search records on multiple fields with partial match and case insensitive  character.
async function findRecordsByFields(searchTerm) {
  try {
    const query = {
      $or: [
        { activityName: { $regex: searchTerm, $options: 'i' } },
        { activityMode: { $regex: searchTerm, $options: 'i' } },
        { resource: { $regex: searchTerm, $options: 'i' } },
        { status: { $regex: searchTerm, $options: 'i' } }
      ]
    };

    const records = await activityModel.find(query);
    return records;
  } catch (error) {
    console.error('Error finding records:', error);
  }
};

module.exports = router;
