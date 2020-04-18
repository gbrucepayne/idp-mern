// Wraps mysql with promisify for query and end
// TODO: JSDoc

const mysql = require('mysql');
const util = require('util');

const dbConfig = require('./config/local');

const db = mysql.createConnection({
  host: dbConfig.host,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
});

const connect = util.promisify(db.connect).bind(db);
const query = util.promisify(db.query).bind(db);
const end = util.promisify(db.end).bind(db);

module.exports = {
  connect,
  query,
  end,
};
