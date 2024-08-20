var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('createActivity', { title: 'Add Activities' });
});

module.exports = router;
