var express = require('express');
var router = express.Router();
const session = require('express-session');
const activityModel = require('./activity');
require('dotenv').config();


/* GET home page. */
router.get('/', async (req, res) => {
  try {
    const currentWeekNumber = getWeekNumber(new Date());

    const { startDate, endDate } = getDateRangeForWeek(currentWeekNumber, new Date().getFullYear());
    const activities = await activityModel.find({ weekNumber: currentWeekNumber });

    // Group activities by activityType
    const groupedActivities = activities.reduce((acc, activity) => {
      if (!acc[activity.activityType]) {
        acc[activity.activityType] = [];
      }
      acc[activity.activityType].push(activity);
      return acc;
    }, {});
    // console.log('Grouped Activities:', groupedActivities)

    res.render('index', { groupedActivities, currentWeekNumber, startDate, endDate });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching activities', error: error.message });
  }
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

router.post('/auth', (req, res) => {
  const { code } = req.body;
  const validCode = process.env.VC; 

  if (code === validCode) {
      req.session.isAuthenticated = true;
      res.redirect('/createactivity');
  } else {
      res.redirect('/auth?error=invalid_code');
  }
});

router.get('/createactivity', authMiddleware, async function(req, res, next) {
  const activities = await activityModel.find().sort({ updatedOn: -1 });
  const msg = req.query.msg === 'successmsg' ? 'New Activity added successfully.' : '';
  res.render('createactivity', { activities, msg });
});

router.post('/createactivity', async (req, res) => {
  
  try {
    let errors = []; 
    let msg;
    const activities = await activityModel.find().sort({ updatedOn: -1 });
    const {activityType, activityName, activityMode, startDate, endDate, resource, remarks} = req.body;
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

    
     console.log(currentWeekNumber);   // .dev
     console.log(startOfWeek);  /// .dev
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
      const [day, month, year] = startDate.split('/');
      const startDateObj = new Date(Date.UTC(year, month - 1, day));
      console.log(startDateObj);        /// .dev
      if (startDateObj < startOfWeek) {
        dateToUse = new Date();
      } else {
        dateToUse = startDateObj;
      }
    }
      console.log(dateToUse);
    // const weekNumber = getWeekNumber(dateObject);
    let weekNum = getWeekNumber(dateToUse);
    console.log(`the week number is ${weekNum}`);

    const newActivity = new activityModel({
      activityType,
      activityName,
      startDate: startDateValue,
      endDate: endDateValue,
      resource,
      activityMode,
      remarks,
      weekNumber: weekNum
      });
    console.log(newActivity);
    await newActivity.save();    //Holding save to check console before writing into DB UNCOMMENT THIS LINE WHEN DATETOUSE IS FIXED.
    // res.status(201).json(savedActivity);
    // req.flash(success: "new activity saved successfully")  //Connect-flash not installed yet. Using js alert for now
        res.redirect('/createactivity?msg=successmsg');
  }
  } catch (error) {
    res.status(500).json({message: "error saving activity", error});
  }
});

router.post('/update/:id', async (req, res) => {
  const { id } = req.params;
  const updatedData = req.body;
  updatedData.updatedOn = Date.now();

  await activityModel.findByIdAndUpdate(id, updatedData);
  res.redirect('/createactivity');
});

router.post('/delete/:id', async (req, res) => {
  const { id } = req.params;
  await activityModel.findByIdAndDelete(id);
  res.redirect('/createactivity');
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

function authMiddleware(req, res, next) {
  if (req.session && req.session.isAuthenticated) {
      return next();
  } else {
      res.redirect('/auth');
  }
}

module.exports = router;
