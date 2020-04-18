//@ts-check
const db = require('../../database/database');

// Mapping category:tableName
const DATABASE_TABLES = {
  'gateway': 'message_gateways',
  'mailbox': 'mailboxes',
  'mobile': 'mobiles',
  'messageMobileOriginated': 'raw_messages',
  'messageMobileTerminated': 'raw_messages',
  'apiCallLog': 'api_calls',
};
// Conversions API:Database
const COLUMN_CONVERSIONS = {
};
const SCHEMA_API_CALLS = {
  'ErrorID': 'errorId',
  'NextStartUTC': 'nextStartUtc',
  'NextStartID': 'nextStartId',
};
const SCHEMA_RAW_MESSAGES = {
  'ID': 'messageId',
  'MessageUTC': 'messageUtc',
  'ReceiveUTC': 'receiveUtc',
  'RegionName': 'regionName',
  'SIN': 'serviceIdNumber',
  'MIN': 'messageIdNumber',
  'MobileID': 'mobileId',
  'OTAMessageSize': 'otaMessageSize',
  'RawPayload': 'rawPayload',
  'Payload': 'payload',
  'ForwardMessageID': 'messageId',
  'DestinationID': 'mobileId',
  'StateUTC': 'stateUtc',
  'ErrorID': 'errorId',
  'UserMessageID': 'userMessageId',
  'ScheduledSendUTC': 'scheduledSendUtc',
  'TerminalWakeupPeriod': 'wakeupPeriod',
  'IsClosed': 'isClosed',
  'State': 'state',
};
const TTL_API_CALL_LOG = 7;  // days(?)
const TTL_MESSAGE = 90;  // days(?)

/**
 * Create the database if it does not exist
 */
async function createDatabase() {
  //TODO set up tables, create triggers and stored procedures
}

function getItemTable(itemBody) {
  if (itemBody.category in DATABASE_TABLES) {
    let tableName = DATABASE_TABLES[itemBody.category];
    let schema = getTableSchema(tableName);
    return [tableName, schema];
  } else {
    throw new Error(`Unknown item category ${itemBody.category}`);
  }
}

function getTableSchema(tableName) {
  switch (tableName) {
    case 'raw_messages':
      return SCHEMA_RAW_MESSAGES;
    default:
      return COLUMN_CONVERSIONS;
  }
}

function convertToColumnNames(itemBody, schema) {
  let newObj = {};
  for (let prop in itemBody) {
    if (itemBody.hasOwnProperty(prop)) {
      if ((prop) in schema) {
        let cProp = schema[prop];
        newObj[cProp] = itemBody[prop];
      } else {
        newObj[prop] = itemBody[prop];
      }
    }
  }
  return newObj;
}

function getKeyByValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}

function convertFromColumnNames(itemBody, schema) {
  let newObj = {};
  for (let prop in itemBody) {
    if (itemBody.hasOwnProperty(prop)) {
      let newProp = getKeyByValue(schema, prop);
      if (typeof(newProp) === 'string') {
        newObj[newProp] = itemBody[prop];
      } else {
        newObj[prop] = itemBody[prop];
      }
    }
  }
  return newObj;
}

/**
 * Create item if it does not exist (noSQL concept)
 */
async function createItem(itemBody) {
  console.log(`createItem: ${JSON.stringify(itemBody)}`);
  let [table, schema] = getItemTable(itemBody);
  let query = `INSERT INTO ${table} SET ?`;
  let newId = -1;
  if (itemBody.payload) {
    itemBody.payload = JSON.stringify(itemBody.payload);
  }
  try {
    let res = await db.query(query, convertToColumnNames(itemBody, schema));
    newId = res.insertId;
  } catch (err) {
    console.log('ERROR: ' + err);
    throw err;
  } finally {
    return newId;
  }
}

/**
 * Query the container using SQL
 * Example: query = 'SELECT VALUE r.children FROM root r WHERE r.lastName = @lastName'
 * parameters = [{name: '@lastName', value: 'Andersen'}]
 */
async function queryDb(query, parameters) {
  let results = [];
  try {
    results = await db.query(query);
  } catch (err) {
    console.log(err);
    throw err;
  } finally {
    return results;
  }
}

async function close() {
  await db.end();
}

/**
 * Replace the item by ID.
 */
async function replaceItem(itemBody) {
  console.log(`replaceItem: ${JSON.stringify(itemBody)}`)
  let [table, schema] = getItemTable(itemBody);
  let query = `UPDATE ${table} SET ? WHERE id = ?`;
  let changedRows = 0;
  try {
    let res = await db.query(query, [convertToColumnNames(itemBody, schema), itemBody.id]);
    changedRows = res.changedRows;
  } catch (err) {
    throw err;
  } finally {
    return changedRows === 1;
  }
}

/**
 * Delete the item by ID.  TODO: broken
 */
async function deleteItem(itemBody) {
  console.log(`deleteItem ${JSON.stringify(itemBody)}`);
  let [table, schema] = getItemTable(itemBody);
  let query = `DELETE FROM ${table} WHERE id = ?`;
  let affectedRows = 0;
  try {
    let res = await db.query(query, [itemBody.id]);
    affectedRows = res.affectedRows;
  } catch (err) {
    throw err;
  } finally {
    return affectedRows === 1;
  }
}

async function initializeDatabase() {
  await createDatabase();
}

async function updateApiCallLogs(apiCallLog) {
  apiCallLog.ttl = TTL_API_CALL_LOG;
  await createItem(apiCallLog);
}

async function updateMobileOriginatedMessages(message) {
  const table = 'raw_messages';
  let schema = getTableSchema(table);
  let query = `SELECT * FROM ${table}` +
              ' WHERE (category = "messageMobileOriginated")' +
              ` AND (messageId = ${message.ID})`;
  const duplicates = await queryDb(query);
  if (duplicates.length === 0) {
    message.category = 'messageMobileOriginated';
    message.ttl = TTL_MESSAGE;
    if (message.RawPayload) {
      message.RawPayload = Buffer.from(message.RawPayload);
    }
    await createItem(convertToColumnNames(message, schema));
    return true;
  } else {
    return false;
  }
}

async function updateMobileTerminatedMessages(message) {
  const table = 'raw_messages';
  let schema = getTableSchema(table); 
  let newStatus = false;
  let query = `SELECT * FROM ${table}` +
              ' WHERE (category = "messageMobileTerminated")' +
              ` AND (messageId = ${message.ForwardMessageID})`;
  const stored = await queryDb(query);
  if (stored.length === 0) {
    message.category = 'messageMobileTerminated';
    message.ttl = TTL_MESSAGE;
    await createItem(convertToColumnNames(message, schema));
    newStatus = true;
  } else {
    let updated = stored[0];
    if (updated.State && updated.State !== message.state) {
      newStatus = true;
    }
    for (let attr in message) { updated[attr] = message[attr] };
    await replaceItem(convertToColumnNames(updated, schema));
  }
  return newStatus;
}

async function getOpenMobileTerminatedIds(accessId) {
  const table = 'raw_messages';
  let messageIds = [];
  let query = `SELECT * FROM ${table}` +
              ' WHERE (category = "messageMobileTerminated")' +
              ` AND accessId = "${accessId}" AND isClosed = false`;
  const openMessages = await queryDb(query);
  if (openMessages.length > 0) {
    for (let m=0; m < openMessages.length; m++) {
      messageIds.push(openMessages[m].messageId);
    }
  }
  //console.log(`Returning open messages: ${JSON.stringify(messageIds)}`);
  return messageIds;
}

async function updateMobileMeta(mobileMeta) {
  const table = 'mobiles';
  //console.log(`updateMobileMeta with ${JSON.stringify(mobileMeta)}`);
  let query = `SELECT * FROM ${table}` +
              ` WHERE mobileId = "${mobileMeta.mobileId}"`;
  const mobile = await queryDb(query);
  if (mobile.length > 0) {
    let meta = mobile[0];
    for (let attr in mobileMeta) {
      meta[attr] = mobileMeta[attr];
    }
    await replaceItem(meta);
  } else {
    await createItem(mobileMeta);
  }
}

async function maintainApiCallLogs(maxRecords) {
  if (typeof(maxRecords != 'int') || maxRecords < 10) {
    maxRecords = 10;
  }
  const table = 'api_calls';
  let query = `SELECT * FROM ${table}` +
              ' ORDER BY _ts ASC';
  const apiCallLogs = await queryDb(query);
  if (apiCallLogs.length > maxRecords) {
    let recordsToDelete = apiCallLogs.length - maxRecords;
    for (let r=0; r < recordsToDelete; r++) {
      await deleteItem(apiCallLogs[r]);
    }
    console.log(`Database maintenance deleted ${recordsToDelete} apiCallLogs`);
  }
}

/**
 * Returns a list of mailboxes from the database
 * @returns {Promise<Object[]>} list of mailboxes
 */
async function getMailboxes() {
  const table = 'mailboxes';
  let schema = getTableSchema(table);
  let query = `SELECT * FROM ${table}`;
  let mailboxes = await queryDb(query);
  for (let m=0; m < mailboxes.length; m++) {
    mailboxes[m] = convertFromColumnNames(mailboxes[m], schema);
  }
  return mailboxes;
}

async function getMailboxGateway(mailbox) {
  const table = 'message_gateways';
  let gatewayName = mailbox.messageGatewayName;
  let query = `SELECT * FROM ${table} WHERE name = "${gatewayName}"`;
  let gateways = await queryDb(query);
  if (gateways.length > 0) {
    return gateways[0].url;
  } else {
    throw new Error(`Gateway not found for ${mailbox.accessId}`);
  }
}

/**
 * 
 * @param {string} mobileId A valid Mobile ID stored in the database
 */
async function getMobileMailbox(mobileId) {
  const mobilesTable = 'mobiles';
  const mailboxesTable = 'mailboxes';
  let mobilesSchema = getTableSchema(mobilesTable);
  let mailboxesSchema = getTableSchema(mailboxesTable);
  const mQuery = `SELECT * FROM ${mobilesTable} WHERE mobileId = "${mobileId}"`;
  const mQueryResult = await queryDb(mQuery);
  if (mQueryResult.length > 0) {
    let mDetail = convertFromColumnNames(mQueryResult[0], mobilesSchema);
    if (typeof(mDetail.accessId) === 'string') {
      let accessId = mDetail.accessId;
      let mbQuery = `SELECT * FROM ${mailboxesTable}` +
                    ` WHERE accessId = "${accessId}"`;
      const mbQueryResult = await queryDb(mbQuery);
      if (mbQueryResult.length > 0) {
        let mbDetail = convertFromColumnNames(mbQueryResult[0], mailboxesSchema);
        return mbDetail;
      } else {
        throw new Error(`Mailbox ${accessId} not found in database`);
      }
    } else {
      throw new Error(`Mailbox for Mobile ID ${mobileId} not found in database`);
    }
  } else {
    throw new Error(`MobileID ${mobileId} not found in database`);
  }
}

/**
 * Returns the credentials and filter criteria for message retrieval
 * @param {Object} mailbox The mailbox object
 * @param {string} queryType The query type for the GET call
 * @returns {Promise<Object>} filter
 */
async function getApiFilter(mailbox, queryType) {
  const SUPPORTED_QUERIES = [
    'get_return_messages',
    'get_forward_statuses',
  ];
  const table = 'api_calls';
  let auth = {
    accessId: mailbox.accessId,
    password: mailbox.password
  };
  if (!(SUPPORTED_QUERIES.includes(queryType))) {
    throw new Error(`Unsupported query ${queryType}`);
    return null;
  }
  let filter = {};
  let query = `SELECT * FROM ${table}`
              + ` WHERE accessId = "${mailbox.accessId}"`
              + ` AND operation = "${queryType}"`
              + ' ORDER BY _ts DESC'
              + ' LIMIT 1';
  const queryResult = await queryDb(query);
  if (queryResult.length > 0) {
    let lastApiCall = queryResult[0];
    if (lastApiCall.nextStartId && lastApiCall.nextStartId > 0) {
      filter.startMessageId = lastApiCall.nextStartId;
      console.log(`Found NextStartID ${filter.startMessageId}`
                + ` from prior API call as filter`);
    } else if (lastApiCall.nextStartUtc !== '' && lastApiCall.nextStartUtc !== null) {
      filter.startTimeUtc = lastApiCall.nextStartUtc.replace(' ', 'T') + 'Z';
      console.log(`Found NextStartUTC ${filter.startTimeUtc}`
                + ` from prior API call as filter`);
    }
  }
  if (typeof(filter.startTimeUtc) !== 'string') {
    let date = new Date();
    date.setUTCHours(date.getUTCHours() - 48);
    filter.startTimeUtc = date.toISOString();
    console.log(`No previous apiCallLog found - filter time ${filter.startTimeUtc}`);
  }
  return filter;
}

/**
 * Returns the credentials and filter criteria for message retrieval
 * @param {Object} mailbox The mailbox object
 * @returns {Promise<Object>} filter
 */
async function getMobileOriginatedQuery(mailbox) {
  const table = 'api_calls';
  let auth = {
    accessId: mailbox.accessId,
    password: mailbox.password
  };
  let filter = {};
  let query = `SELECT * FROM ${table}`
              + ` WHERE accessId = "${mailbox.accessId}"`
              + ' AND operation = "get_return_messages"'
              + ' ORDER BY _ts DESC'
              + ' LIMIT 1';
  const queryResult = await queryDb(query);
  if (queryResult.length > 0) {
    let lastApiCall = queryResult[0];
    if (!isNaN(lastApiCall.nextStartId) && lastApiCall.nextStartId !== -1) {
      filter.startMessageId = lastApiCall.nextStartId;
      console.log(`Found NextStartID ${filter.startMessageId}`
                + ` from prior API call as filter`);
    } else if (lastApiCall.nextStartUtc !== '') {
      filter.startTimeUtc = lastApiCall.nextStartUtc;
      console.log(`Found NextStartUTC ${filter.startTimeUtc}`
                + ` from prior API call as filter`);
    }
  }
  if (typeof(filter.startTimeUtc) !== 'string') {
    let date = new Date();
    date.setUTCHours(date.getUTCHours() - 48);
    filter.startTimeUtc = date.toISOString();
    console.log(`No previous apiCallLog found - filter time ${filter.startTimeUtc}`);
  }
  return filter;
}

module.exports = {
  initializeDatabase,
  getMailboxes,
  getApiFilter,
  getMobileOriginatedQuery,
  updateMobileMeta,
  updateMobileOriginatedMessages,
  updateMobileTerminatedMessages,
  getOpenMobileTerminatedIds,
  getMobileMailbox,
  updateApiCallLogs,
  maintainApiCallLogs,
  getMailboxGateway,
  close,
  createItem,   //TODO: REMOVE
}
