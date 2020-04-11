const express = require('express');
const router = express.Router();
const mysql = require('mysql');

const dbConfig = require('../config/db');

const db = mysql.createConnection({
  host: dbConfig.host,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
});

// Variable to be sent to Frontend with Database status
let databaseConnection = "Waiting for Database response...";

router.get("/", function(req, res, next) {
    res.send(databaseConnection);
});

db.connect(function(err) {
  if (err) {
    databaseConnection = "Error connecting to Database";
  } else {
    databaseConnection = "Database Connected!";
  }
});

module.exports = router;