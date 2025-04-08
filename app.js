var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const session = require('express-session');
const favicon = require('serve-favicon');
const mongoose = require('mongoose');
const mongoSanitize = require('express-mongo-sanitize');
// const cors = require('cors');
// const MongoStore = require('connect-mongo');
const indexRouter = require('./routes/index');
// var resourceRouter = require('./routes/resource');
// var taskRouter = require('./routes/task');
var app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(mongoSanitize()); // Sanitize user input to prevent NoSQL injection

mongoose.connect(process.env.MONGO_URI, {}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('Error connecting to MongoDB', err);
});

// app.use(cors({
//   origin: ['https://app.chrysalistechnologies.in/',  '/\.chrysalistechnologies\.in$/'],
//   credentials: true
// }));

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

if (!process.env.EXPRESS_SESSION_SECRET) {
  throw new Error('EXPRESS_SESSION_SECRET is not defined');
}

app.use(session({
  secret: process.env.EXPRESS_SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  // store: new MongoStore({
  //   mongoUrl: process.env.MONGO_URI,
  //   collectionName: 'sessions',
  //   ttl: 8 * 60 * 60 * 1000// Session expiration time in seconds
  // }),
  cookie: { 
    maxAge: 60 * 60 * 1000, // 60 minutes
    // domain: '.chrysalistechnologies.in', // Makes the cookie accessible to all subdomains
    // path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'None', // Allows cross-site cookie sharing
   } 
}));

// app.use((req, res, next) => {
//   res.header('Access-Control-Allow-Origin', 'https://fac.chrysalistechnologies.in/test');
//   res.header('Access-Control-Allow-Credentials', 'true');
//   next();
// });

app.use(favicon(path.join(__dirname, 'favicon.ico')));
app.use(logger('dev'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
// app.use('/resource', resourceRouter);
// app.use('/task', taskRouter);

app.use((req, res, next) => {
  console.log(`Instance: ${process.env.APP_NAME}, User: ${req.ip}`);
  next();
}); 

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  res.render('404');
  // next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  // res.locals.message = err.message;
  // res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  // res.status(err.status || 500);
  // res.render('error');
  res.status(err.status || 500).render('error', {
    errorCode: 500,
    errorMessage: err.message
  });
});

module.exports = app;
