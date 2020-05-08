//'use strict';
const DataHandler = require('../database/dataHandler');

const uavDevicesUnderTest = [
  '01454355SKYAF9C',
  '01454373SKYF7F6',
  '01459442SKY0EF7',
];

/**
 * Rounds a number to a certain decimal precision
 * @param {number} num A decimal number
 * @param {number} places The number of decimal places to round to
 * @returns {number} rounded
 */
function roundTo(num, places) {
  if (typeof (places) !== 'number') places = 0;
  return +(Math.round(num + 'e+' + places) + 'e-' + places);
}

/**
 * Parses Inmarsat-defined standard modem Mobile-Originated messages
 * @public
 * @param {ReturnMessage} returnMessage The message with metadata
 * @returns {Object} parsed message
 */
function parseUav(returnMessage) {
  const mobileId = returnMessage.MobileID;
  if (!uavDevicesUnderTest.includes(mobileId)) {return;}
  let dateStamp = returnMessage.MessageUTC.substring(0,10) + 'T' + returnMessage.MessageUTC.substring(11) + 'Z';
  const msgMeta = {
    mobileId: returnMessage.MobileID,
    timestamp: new Date(dateStamp),
    messageId: returnMessage.ID,
  };
  const message = returnMessage.Payload;
  switch (message.MIN) {
    case 1:
      return parseLocation(message, msgMeta);
    case 2:
      return parseSerialData(message, msgMeta);
    case 3:
      return parseConfigReport(message, msgMeta);
    default:
      console.log(`No parsing logic defined for SIN 0 MIN ${message.MIN}`);
      return undefined;
  }
}

/**
 * @typedef MessagePayload
 * @property {number} SIN Service Identification Number
 * @property {number} MIN Message Identification Number
 * @property {string} Name Descriptor of message
 * @property {MessageField[]} Fields An array of data fields
 */

/**
 * @typedef MessageField
 * @property {string} Name Descriptor of field content
 * @property {string} Value String value of variant type
 * @property {string} Type Data type used for decoding Value
 */

const fieldTypes = {
  'unsignedint': 'number',
  'signedint': 'number',
  'enum': 'string',
  'boolean': 'boolean',
  'string': 'string',
  'data': 'string',
  'array': 'Object'
};

function notification(meta, messageName) {
  let notify = {};
  Object.assign(notify, meta);
  notify.name = messageName;
  return notify;
}

/*
function getData(dataField) {
  return Buffer.from(b64string, 'base64');
}
// */

/**
 * @typedef ArrayField
 * @property {Object[]} Elements Descriptor of field content
 * @property {MessageField[]} Fields String value of variant type
 */

/**
 * @typedef MessageMetadata
 * @property {string} mobileId unique Mobile ID of terminal
 * @property {Date} timestamp received time of the message
 * @property {string} [topic] optional filter topic for event routing
 */

/**
 * Parses the UAV location message
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
async function parseLocation(message, meta) {
  let mobileMeta = {};
  Object.assign(mobileMeta, meta)
  const fields = message.Fields;
  for (var f = 0; f < fields.length; f++) {
    switch (fields[f].Name) {
      case 'latitude':
        mobileMeta.latitude = roundTo(Number(fields[f].Value) / 60000, 6);
        break;
      case 'longitude':
        mobileMeta.longitude = roundTo(Number(fields[f].Value) / 60000, 6);
        break;
      case 'altitude':
        mobileMeta.altitude_m = Number(fields[f].Value);
        break;
      case 'speed':
        mobileMeta.speed_knots = Number(fields[f].Value);
        break;
      case 'heading':
        mobileMeta.heading = Number(fields[f].Value);
        break;
      case 'timestamp':
        mobileMeta.fix_time = new Date(Number(fields[f].Value) * 1000);
        break;
      case 'fixType':
        mobileMeta.fix_type = fields[f].Value;
        break;
      case 'numSats':
        mobileMeta.gnss_num_sats = Number(fields[f].Value);
        break;
      case 'hdop':
        mobileMeta.gnss_hdop = Number(fields[f].Value);
        break;
      case 'fixAge':
        mobileMeta.fix_age = Number(fields[f].Value);
        break;
      case 'jammingIndicator':
        mobileMeta.gnss_jamming = fields[f].Value;
        break;
      case 'msgNum':
          mobileMeta.msg_count = Number(fields[f].Value);
          break;
      default:
        console.warn(` Unknown field: ${fields[f].Name}`);
    }
  }
  // fix_time is unix seconds since epoch
  mobileMeta.latency = ((meta.timestamp - mobileMeta.fix_time) / 1000).toFixed(0);
  // TODO: (Geoff) store in time series database
  const database = new DataHandler();
  await database.initialize();
  await database.updateUavReturnMessages(mobileMeta);
  await database.close();
  return notification(mobileMeta, message.Name);
}

/**
 * Parses the UAV serialData message
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
async function parseSerialData(message, meta) {
  let mobileMeta = {};
  Object.assign(mobileMeta, meta)
  const fields = message.Fields;
  for (var f = 0; f < fields.length; f++) {
    switch (fields[f].Name) {
      case 'data':
        mobileMeta.data = fields[f].Value;
        break;
      default:
        console.warn(` Unknown field: ${fields[f].Name}`);
    }
  }
  const database = new DataHandler();
  await database.initialize();
  await database.updateUavReturnMessages(mobileMeta);
  await database.close();
  return notification(mobileMeta, message.Name);
}

/**
 * Parses the UAV configReport message
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
async function parseConfigReport(message, meta) {
  let mobileMeta = {};
  Object.assign(mobileMeta, meta)
  const fields = message.Fields;
  for (var f = 0; f < fields.length; f++) {
    switch (fields[f].Name) {
      case 'interval':
        mobileMeta.interval = Number(fields[f].Value);
        break;
      case 'serialEnabled':
        mobileMeta.serial_enabled = Boolean(fields[f].Value);
        break;
      case 'serialBaudRate':
        mobileMeta.serial_baudrate = Number(fields[f].Value);
        break;
      case 'serialDataBits':
        mobileMeta.serial_databits = fields[f].Value === 'BITS_EIGHT' ? 8 : 7;
        break;
      case 'serialParity':
        mobileMeta.serial_parity = fields[f].Value;
        break;
      case 'serialStopBits':
        mobileMeta.serial_stopbits = fields[f].Value;
        break;
      case 'serialFraming':
        mobileMeta.serial_framing = fields[f].Value;
        break;
      case 'serialFrameStart':
        mobileMeta.serial_sof = fields[f].Value;
        break;
      case 'serialFrameEnd':
        mobileMeta.serial_eof = fields[f].Value;
        break;
      case 'serialLineDelimiter':
        mobileMeta.serial_eol = fields[f].Value;
        break;
      case 'error':
        mobileMeta.error = fields[f].Value;
        break;
      default:
        console.warn(` Unknown field: ${fields[f].Name}`);
    }
  }
  const database = new DataHandler();
  await database.initialize();
  await database.updateUavMeta(mobileMeta);
  await database.close();
  return notification(mobileMeta, message.Name);
}


function encodeConfigMessage() {
  var message = {
    IsForward: true,
    SIN: 128,
    MIN: 4,
    Name: 'requestBroadcastIds',
    Fields: []
  };
  var rawPayload = [0, 115];
  return { message, rawPayload };
}

function encodeTestMessage() {
  var message = {
    IsForward: true,
    SIN: 128,
    MIN: 4,
    Name: 'requestBroadcastIds',
    Fields: []
  };
  var rawPayload = [0, 115];
  return { message, rawPayload };
}

module.exports = {
  parseUav,
  encodeConfigMessage,
  commandMessages: {
    test: encodeTestMessage(),
  }
};
