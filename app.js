var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const session = require('express-session');
const favicon = require('serve-favicon');


var indexRouter = require('./routes/index');
var activityRouter = require('./routes/activity');
var escalationRouter = require('./routes/escalation')
var app = express();


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(session({
  secret: 'a8f5f167f44f4964e6c998dff827110c',
  resave: false,
  saveUninitialized: true
}));
app.use(favicon(path.join(__dirname, 'favicon.png')));
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/activity', activityRouter);
app.use('/escalation', escalationRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  res.render('404');
  // next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
