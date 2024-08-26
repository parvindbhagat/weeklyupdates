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

router.get('/editdelete', async function(req, res, next) {
  const activities = await activityModel.find().sort({ updatedOn: -1 });
  res.render('editdelete', { activities });
});

router.get('/auth', (req, res) => {
  res.render('auth');
});

router.post('/auth', (req, res) => {
  const { code } = req.body;
  const validCode = process.env.VC; 

  if (code === validCode) {
      req.session.isAuthenticated = true;
      res.redirect('/createactivity');
  } else {
      res.redirect('/auth');
  }
});

router.get('/createactivity', authMiddleware, async function(req, res, next) {
  const activities = await activityModel.find().sort({ updatedOn: -1 });
  res.render('createactivity', { activities });
});

router.post('/createactivity', async (req, res) => {
  
  try {
    let errors = []; 
    const {activityType, activityName, startDate, endDate, resource, remarks} = req.body;
    if (!activityType || !activityName || !resource || !remarks) {
      errors.push({ msg: "Please fill in all required fields: Activity Type/Name, resource and remarks." });
    }
    const startDateValue = startDate && startDate.trim() !== "" ? startDate : "NA";
    const endDateValue = endDate && endDate.trim() !== "" ? endDate : "NA";

    let dateToUse;
    if (startDateValue !== "NA") {
      console.log(startDateValue);
      const [day, month, year] = startDate.split('/');
      dateToUse = new Date(Date.UTC(year, month - 1, day));
    } else {
      dateToUse = new Date();
    }
   console.log('datetouse is ', dateToUse);
    
    // const weekNumber = getWeekNumber(dateObject);
    let weekNum = getWeekNumber(dateToUse);
    console.log(`the week number is ${weekNum}`);

    const newActivity = new activityModel({
      activityType,
      activityName,
      startDate: startDateValue,
      endDate: endDateValue,
      resource,
      remarks,
      weekNumber: weekNum
      });
    // console.log(newActivity);
    await newActivity.save();    //Holding save to check console before writing into DB UNCOMMENT THIS LINE WHEN DATETOUSE IS FIXED.
    // res.status(201).json(savedActivity);
    // req.flash(success: "new activity saved successfully")  //Connect-flash not installed yet. Using js alert for now
    
    res.redirect('/createactivity');
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
