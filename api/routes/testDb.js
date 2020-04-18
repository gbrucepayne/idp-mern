const express = require('express');
const router = express.Router();
/*
const mysql = require('mysql');

const dbConfig = require('../config/db');

const db = mysql.createConnection({
  host: dbConfig.host,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
});
*/
const db = require('../../database/database');
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

router.get('/mgs', function(req, res, next) {
  const mgsQuery = 'SELECT * FROM message_gateways';
  db.query(mgsQuery, (err, rows) => {
    if (err) {
      res.send(err);
    } else {
      let gatewayList = 'Message Gateways:\n';
      for (let r=0; r < rows.length; r++) {
        gatewayList = gatewayList + rows[r].url + '\n';
      }
      res.send(gatewayList);
    }
  });
});

module.exports = router;