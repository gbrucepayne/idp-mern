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
const DbConnection = require('../../database/databaseConnector');
const db = new DbConnection();

(async function initializeDb() {
  await db.initialize();
})();
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
      console.error(err);
      res.json({"error": true});
    } else {
      res.json(rows);
    }
  });
});

router.get('/uav', function(req, res, next) {
  const uavQuery = 'SELECT * FROM uav_messages ORDER BY timestamp DESC LIMIT 500';
  db.query(uavQuery, (err, rows) => {
    if (err) {
      console.error(err);
      res.json({"error": true});
    } else {
      res.json(rows);
    }
  });
});

module.exports = router;