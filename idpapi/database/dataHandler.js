//@ts-check
const DbConnector = require('../../database/databaseConnector');

// Mapping category:tableName
const DATABASE_TABLES = {
  'gateway': 'message_gateways',
  'mailbox': 'mailboxes',
  'mobile': 'mobiles',
  'messageMobileOriginated': 'raw_messages',
  'messageMobileTerminated': 'raw_messages',
  'apiCallLog': 'api_calls',
  'messageReturn': 'uav_messages',
  'messageForward': 'uav_messages',
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
  'ReferenceNumber': 'referenceNumber',
};
const TTL_API_CALL_LOG = 7;  // days(?)
const TTL_MESSAGE = 90;  // days(?)
/*
async function initialize() {
  await this.db.initialize();
}
*/
function getTableSchema(tableName) {
  switch (tableName) {
    case 'raw_messages':
      return SCHEMA_RAW_MESSAGES;
    default:
      return COLUMN_CONVERSIONS;
  }
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
async function createItem(db, itemBody) {
  let [table, schema] = getItemTable(itemBody);
  console.log(`createItem in ${table}: ${JSON.stringify(itemBody)}`);
  let query = `INSERT INTO ${table} SET ?`;
  let newId = -1;
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
 * Replace the item by ID.
 */
async function replaceItem(db, itemBody) {
  let [table, schema] = getItemTable(itemBody);
  console.log(`replaceItem in ${table}: ${JSON.stringify(itemBody)}`)
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
async function deleteItem(db, itemBody) {
  let [table, schema] = getItemTable(itemBody);
  console.log(`deleteItem from ${table}: ${JSON.stringify(itemBody)}`);
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

async function close() {
  await this.db.end();
}

async function updateApiCallLogs(apiCallLog) {
  //apiCallLog.ttl = TTL_API_CALL_LOG;
  await createItem(this.db, apiCallLog);
}

async function updateApiAlive(gatewayUrl, isAlive) {
  const table = 'message_gateways';
  let query = `SELECT * FROM ${table} WHERE url = "${gatewayUrl}"`;
  let gateway = await this.db.query(query);
  let changed = false;
  if (gateway.length > 0) {
    if (isAlive != gateway[0].alive) {
      let updated = gateway[0];
      updated.alive = isAlive;
      updated.event_time = new Date().toISOString();
      await replaceItem(this.db, updated);
      changed = true;
    }
  }
  return changed;
}

function convertPayloads(message) {
  let converted = {}
  Object.assign(converted, message)
  if (message.RawPayload) {
    converted.RawPayload = Buffer.from(message.RawPayload);
  }
  if (message.Payload) {
    converted.Payload = JSON.stringify(message.Payload);
  }
  return converted;
}

async function updateMobileOriginatedMessages(message) {
  const table = 'raw_messages';
  const category = 'messageMobileOriginated';
  let schema = getTableSchema(table);
  let query = `SELECT * FROM ${table}`
      + ` WHERE category = "${category}"`
      + ` AND messageId = ${message.ID}`;
  const duplicates = await this.db.query(query);
  if (duplicates.length === 0) {
    message.category = category;
    message.ttl = TTL_MESSAGE;
    let dbEntry = convertPayloads(message);
    await createItem(this.db, convertToColumnNames(dbEntry, schema));
    return true;
  } else {
    return false;
  }
}

async function updateMobileTerminatedMessages(message) {
  const table = 'raw_messages';
  const category = 'messageMobileTerminated';
  let schema = getTableSchema(table); 
  let newStatus = false;
  let query = `SELECT * FROM ${table}`
      + ` WHERE category = "${category}"`
      + ` AND messageId = ${message.ForwardMessageID}`;
  const stored = await this.db.query(query);
  if (stored.length === 0 && message.DestinationID) {
    message.category = category;
    message.ttl = TTL_MESSAGE;
    let dbEntry = convertPayloads(message);
    await createItem(this.db, convertToColumnNames(dbEntry, schema));
    newStatus = true;
  } else if (stored.length > 0) {
    let updated = stored[0];
    if (updated.state !== message.State) {
      newStatus = true;
      if (message.State > 1) {
        //TODO (Geoff) notify failure
      }
      for (let attr in message) {
        updated[attr] = message[attr];
      };
      let dbEntry = convertPayloads(updated);
      await replaceItem(this.db, convertToColumnNames(dbEntry, schema));
    }
  } else {
    // TODO: get forward message (submitted by some other process)
    console.debug(`Retrieved status for unknown forward message submission ${message.ForwardMessageID}`);
  }
  return newStatus;
}

async function isMessageInDatabase(message) {
  const table = 'raw_messages';
  const category = 'messageMobileTerminated';
  let schema = getTableSchema(table); 
  let newStatus = false;
  let query = `SELECT * FROM ${table}`
      + ` WHERE category = "${category}"`
      + ` AND messageId = ${message.ForwardMessageID}`;
  const stored = await this.db.query(query);
  if (stored.length === 0) {
    return false;
  }
  return true;
}

async function getOpenMobileTerminatedIds(accessId) {
  const table = 'raw_messages';
  const category = 'messageMobileTerminated';
  let messageIds = [];
  let query = `SELECT * FROM ${table}` +
              ` WHERE category = "${category}"` +
              ` AND accessId = "${accessId}" AND isClosed = false`;
  const openMessages = await this.db.query(query);
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
  let query = `SELECT * FROM ${table}`
      + ` WHERE mobileId = "${mobileMeta.mobileId}"`;
  const mobile = await this.db.query(query);
  if (mobile.length > 0) {
    let meta = mobile[0];
    for (let attr in mobileMeta) {
      meta[attr] = mobileMeta[attr];
    }
    await replaceItem(this.db, meta);
  } else {
    await createItem(this.db, mobileMeta);
  }
}

async function maintainApiCallLogs(maxRecords) {
  if (typeof(maxRecords != 'int') || maxRecords < 10) {
    maxRecords = 10;
  }
  const table = 'api_calls';
  let query = `SELECT * FROM ${table}` +
              ' ORDER BY _ts ASC';
  const apiCallLogs = await this.db.query(query);
  if (apiCallLogs.length > maxRecords) {
    let recordsToDelete = apiCallLogs.length - maxRecords;
    for (let r=0; r < recordsToDelete; r++) {
      await deleteItem(this.db, apiCallLogs[r]);
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
  let query = `SELECT * FROM ${table} WHERE enabled = true`;
  let mailboxes = await this.db.query(query);
  for (let m=0; m < mailboxes.length; m++) {
    mailboxes[m] = convertFromColumnNames(mailboxes[m], schema);
  }
  return mailboxes;
}

async function getMailboxGateway(mailbox) {
  const table = 'message_gateways';
  let gatewayName = mailbox.messageGatewayName;
  let query = `SELECT * FROM ${table} WHERE name = "${gatewayName}"`;
  let gateways = await this.db.query(query);
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
  const mQueryResult = await this.db.query(mQuery);
  if (mQueryResult.length > 0) {
    let mDetail = convertFromColumnNames(mQueryResult[0], mobilesSchema);
    if (typeof(mDetail.accessId) === 'string') {
      let accessId = mDetail.accessId;
      let mbQuery = `SELECT * FROM ${mailboxesTable}` +
                    ` WHERE accessId = "${accessId}"`;
      const mbQueryResult = await this.db.query(mbQuery);
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
  const queryResult = await this.db.query(query);
  if (queryResult.length > 0) {
    let lastApiCall = queryResult[0];
    if (lastApiCall.nextStartId && lastApiCall.nextStartId > 0) {
      filter.startMessageId = lastApiCall.nextStartId;
      console.debug(`Found NextStartID ${filter.startMessageId}`
                + ` for mailbox ${mailbox.accessId} as filter`);
    } else if (lastApiCall.nextStartUtc !== ''
        && lastApiCall.nextStartUtc !== null) {
      filter.startTimeUtc = lastApiCall.nextStartUtc.replace(' ', 'T') + 'Z';
      console.log(`Found NextStartUTC ${filter.startTimeUtc}`
                + ` for mailbox ${mailbox.accessId} as filter`);
    }
  }
  if (typeof(filter.startTimeUtc) !== 'string') {
    let date = new Date();
    date.setUTCHours(date.getUTCHours() - 48);
    filter.startTimeUtc = date.toISOString();
    console.debug(`No previous ${queryType} apiCallLog found for ${mailbox.accessId} - filter time`
        + ` ${filter.startTimeUtc}`);
  }
  return filter;
}

// ************************* UAV POC ONLY **************************
async function updateUavMeta(mobileMeta) {
  const table = 'uav_mobiles';
  //console.log(`updateMobileMeta with ${JSON.stringify(mobileMeta)}`);
  let query = `SELECT * FROM ${table}`
      + ` WHERE mobileId = "${mobileMeta.mobileId}"`;
  const mobile = await this.db.query(query);
  if (mobile.length > 0) {
    let meta = mobile[0];
    for (let attr in mobileMeta) {
      meta[attr] = mobileMeta[attr];
    }
    await replaceItem(this.db, meta);
  } else {
    await createItem(this.db, mobileMeta);
  }
}

async function updateUavReturnMessages(message) {
  const table = 'uav_messages';
  const category = 'messageReturn';
  let schema = getTableSchema(table);
  let query = `SELECT * FROM ${table}`
      + ` WHERE category = "${category}"`
      + ` AND messageId = ${message.messageId}`;
  const duplicates = await this.db.query(query);
  if (duplicates.length === 0) {
    message.category = category;
    message.ttl = TTL_MESSAGE;
    let dbEntry = convertPayloads(message);
    await createItem(this.db, convertToColumnNames(dbEntry, schema));
    return true;
  } else {
    console.warn(`Message ${message.messageId} already in database`);
    return false;
  }
}

async function updateUavForwardMessages(message) {
  const table = 'uav_messages';
  const category = 'messageForward';
  let schema = getTableSchema(table); 
  let newStatus = false;
  let query = `SELECT * FROM ${table}`
  + ` WHERE category = "${category}"`
  + ` AND messageId = ${message.ForwardMessageID}`;
  const stored = await this.db.query(query);
  if (message.serviceIdNumber && message.serviceIdNumber === 128) {
    message.category = category;
    message.ttl = TTL_MESSAGE;
    let dbEntry = convertPayloads(message);
    await createItem(this.db, convertToColumnNames(dbEntry, schema));
    newStatus = true;
  } else if (stored.length > 0) {
    let updated = stored[0];
    if (updated.state && updated.state !== message.state) {
      newStatus = true;
      if (message.state === '') {
        //let latency = 
      }
    }
    for (let attr in message) {
      updated[attr] = message[attr];
    };
    let dbEntry = convertPayloads(message);
    await replaceItem(this.db, convertToColumnNames(dbEntry, schema));
  }
  return newStatus;
}

// *****************************************************************

function DataHandler(name) {
  this.name = name;
  this.db = new DbConnector();
}
DataHandler.prototype.initialize = async function() {
  await this.db.initialize();
}
DataHandler.prototype.getMailboxes = getMailboxes;
DataHandler.prototype.getApiFilter = getApiFilter;
DataHandler.prototype.updateMobileMeta = updateMobileMeta;
DataHandler.prototype.updateMobileOriginatedMessages = updateMobileOriginatedMessages;
DataHandler.prototype.isMessageInDatabase = isMessageInDatabase;
DataHandler.prototype.updateMobileTerminatedMessages = updateMobileTerminatedMessages;
DataHandler.prototype.getOpenMobileTerminatedIds = getOpenMobileTerminatedIds;
DataHandler.prototype.getMobileMailbox = getMobileMailbox;
DataHandler.prototype.updateApiCallLogs = updateApiCallLogs;
DataHandler.prototype.maintainApiCallLogs = maintainApiCallLogs;
DataHandler.prototype.getMailboxGateway = getMailboxGateway;
DataHandler.prototype.updateApiAlive = updateApiAlive;
DataHandler.prototype.close = close;
DataHandler.prototype.updateUavMeta = updateUavMeta;
DataHandler.prototype.updateUavReturnMessages = updateUavReturnMessages;
DataHandler.prototype.updateUavForwardMessages = updateUavForwardMessages;

module.exports = DataHandler;
/*
module.exports = {
  initialize,
  getMailboxes,
  getApiFilter,
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
  // *** UAV only
  updateUavMeta,
  updateUavReturnMessages,
  updateUavForwardMessages,
}
// */