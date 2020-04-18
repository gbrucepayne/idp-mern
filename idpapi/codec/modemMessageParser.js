const database = require('../database/database');

'use strict';

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
 * Returns a datestamp from a day and minute, assuming the current year
 * @param {number} year Full year UTC
 * @param {number} month From 0..11 UTC
 * @param {number} dayOfMonth Day of month from 1..31 UTC
 * @param {number} minuteOfDay Minute of day from 0..1439 UTC
 * @returns {Date}
 */
function timestampFromMinuteDay(year, month, dayOfMonth, minuteOfDay) {
  const hour = minuteOfDay / 60;
  const minute = minuteOfDay % 60;
  const tsDate = new Date(year, month, dayOfMonth, hour, minute);
  return tsDate;
}

/**
 * Parses Inmarsat-defined standard modem Mobile-Originated messages
 * @public
 * @param {ReturnMessage} returnMessage The message with metadata
 * @returns {Object} parsed message
 */
function parseCoreModem(returnMessage) {
  const msgMeta = {
    mobileId: returnMessage.MobileID,
    timestamp: new Date(returnMessage.MessageUTC),
  };
  const message = returnMessage.Payload;
  switch (message.MIN) {
    case 97:
    case 1:
    case 0:
      return parseModemRegistration(message, msgMeta);
    case 2:
      return parseModemProtocolError(message, msgMeta);
    case 70:
      return parseModemSleepSchedule(message, msgMeta);
    case 72:
      return parseModemLocation(message, msgMeta);
    case 98:
      return parseModemLastRxInfo(message, msgMeta);
    case 99:
      return parseModemRxMetrics(message, msgMeta);
    case 100:
      return parseModemTxMetrics(message, msgMeta);
    case 112:
      return parseModemPingReply(message, msgMeta);
    case 113:
      return parseNetworkPingRequest(message, msgMeta);
    case 115:
      return parseModemBroadcastIds(message, msgMeta);
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
 * Parses the Registration message
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
function parseModemRegistration(message, meta) {
  let mobileMeta = {
    mobileId: meta.mobileId,
  };
  if (message.MIN === 0) mobileMeta.lastRegistration = meta.timestamp;
  let tmp = {};
  const fields = message.Fields;
  for (var f = 0; f < fields.length; f++) {
    switch (fields[f].Name) {
      case 'hardwareMajorVersion':
        tmp.hwMajorVersion = fields[f].Value;
        break;
      case 'hardwareMinorVersion':
        tmp.hwMinorVersion = fields[f].Value;
        break;
      case 'softwareMajorVersion':
        tmp.swMajorVersion = fields[f].Value;
        break;
      case 'softwareMinorVersion':
        tmp.swMinorVersion = fields[f].Value;
        break;
      case 'product':
        tmp.productId = fields[f].Value;
        break;
      case 'wakeupPeriod':
        mobileMeta.wakeupPeriod = fields[f].Value;
        notifyMessage.wakeupPeriod = fields[f].Value;
        break;
      case 'lastResetReason':
        notifyMessage.lastResetReason = fields[f].Value;
        break;
      case 'virtualCarrier':
        notifyMessage.vcId = fields[f].Value;
        break;
      case 'beam':
        notifyMessage.beamId = fields[f].Value;
        break;
      case 'vain':
        notifyMessage.vain = fields[f].Value;
        break;
      case 'operatorTxState':
        notifyMessage.operatorTxState = fields[f].Value;
        break;
      case 'userTxState':
        notifyMessage.userTxState = fields[f].Value;
        break;
      case 'broadcastIDCount':
        notifyMessage.bcIdCount = fields[f].Value;
        break;
      default:
        console.warn(` Unknown field: ${fields[f].Name}`);
    }
  }

  if (tmp.hwMajorVersion) {
    var hwVersion = tmp.hwMajorVersion.toString() + '.' + tmp.hwMinorVersion.toString();
    var swVersion = tmp.swMajorVersion.toString() + '.' + tmp.swMinorVersion.toString();
    vlog(logLevels.DEBUG, fName + ' found HW version:' + hwVersion + ' | SW version:' + swVersion);
    mobileMeta.modemHwVersion = hwVersion;
    mobileMeta.modemSwVersion = swVersion;
    mobileMeta.modemProductId = tmp.productId;
  }
  database.updateMobileMeta(mobileMeta);
  return notification(mobileMeta, message.Name);
}

/**
 * Parses the modem error message
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
function parseModemProtocolError(message, meta) {
  let mobileMeta = { mobileId: meta.mobileId };
  const fields = message.Fields;
  let notifyMessage = notification(mobileMeta, message.Name);
  for (let f = 0; f < fields.length; f++) {
    vlog(logLevels.DEBUG, fName + ' Field Name: ' + fields[f].Name + ' | Field Value: ' + fields[f].Value);
    switch (fields[f].Name) {
      case 'messageReference':
        notifyMessage.msgRef = fields[f].Value;
        break;
      case 'errorCode':
        notifyMessage.errorCode = fields[f].Value;
        switch (notifyMessage.errorCode) {
          case 1:
            notifyMessage.errorDesc = 'Unable to allocate message buffer';
            break;
          case 2:
            notifyMessage.errorDesc = 'Unknown message type';
            break;
          default:
            notifyMessage.errorDesc = 'UNHANDLED ERROR';
        }
        break;
      case 'errorInfo':
        notifyMessage.errorInfo = fields[f].Value;
        break;
      default:
        console.warn(`Unknown field: ${fields[f].Name}`);
    }
  }
  return notifyMessage;
}

/**
 * Returns the wakeup interval in seconds
 * @private
 * @param {number | string} wakeupCode 
 * @returns {number}
 */
function getWakeupSeconds(wakeupCode) {
  let interval = 5;
  switch (wakeupCode) {
    case 0:
    case 'None':
      interval = 5;
      break;
    case 1:
    case 'Seconds30':
      interval = 30;
      break;
    case 2:
    case 'Seconds60':
      interval = 60;
      break;
    case 3:
    case 'Minutes3':
      interval = 3 * 60;
      break;
    case 4:
    case 'Minutes10':
      interval = 10 * 60;
      break;
    case 5:
    case 'Minutes30':
      interval = 30 * 60;
      break;
    case 6:
    case 'Minutes2':
      interval = 2 * 60;
      break;
    case 7:
    case 'Minutes5':
      interval = 5 * 60;
      break;
    case 8:
    case 'Minutes15':
      interval = 15 * 60;
      break;
    case 9:
    case 'Minutes20':
      interval = 20 * 60;
      break;
    default:
      console.warn(`unrecognized wakeupPeriod: ${wakeupCode}`);
  }
  return interval;
}

/**
 * Parses wakeup interval change notification
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
function parseModemSleepSchedule(message, meta) {
  let mobileMeta = { mobileId: meta.mobileId };
  const fields = message.Fields;
  let notifyMessage = notification(mobileMeta, message.Name);
  for (let f = 0; f < fields.length; f++) {
    vlog(logLevels.DEBUG, fName + ' Field Name: ' + fields[f].Name + ' | Field Value: ' + fields[f].Value);
    switch (fields[f].Name) {
      case 'wakeupPeriod':
        mobileMeta.wakeupPeriod = fields[f].Value.toString();
        notifyMessage.wakeupPeriod = fields[f].Value;
        break;
      case 'mobileInitiated':
        notifyMessage.localInitiated = fields[f].Value;
        break;
      case 'messageReference':
        notifyMessage.setWakeupMsgRefNo = fields[f].Value;
        break;
      default:
        console.warn(`Unknown field: ${fields[f].Name}`);
    }
  }
  database.updateMobileMeta(mobileMeta);
  return notifyMessage;
}

/**
 * Parses location and timestamp data to update the IdpMobiles collection with device metadata
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
function parseModemLocation(message, meta) {
  let mobileMeta = { mobileId: meta.mobileId };
  let tmp = {};
  const fields = message.Fields;
  for (let f = 0; f < fields.length; f++) {
    switch (fields[f].Name) {
      case 'fixStatus':
        mobileMeta.locFixStatus = Number(fields[f].Value);
        break;
      case 'latitude':
        mobileMeta.locLatitude = roundTo(Number(fields[f].Value) / 60000, 6);
        break;
      case 'longitude':
        mobileMeta.locLongitude = roundTo(Number(fields[f].Value) / 60000, 6);
        break;
      case 'altitude':
        mobileMeta.locAltitude = Number(fields[f].Value);
        break;
      case 'speed':
        mobileMeta.locSpeed = Number(fields[f].Value);
        break;
      case 'heading':
        mobileMeta.locHeading = Number(fields[f].Value) * 2;
        break;
      case 'dayOfMonth':
        tmp.dayUtc = Number(fields[f].Value);
        break;
      case 'minuteOfDay':
        tmp.minuteOfDayUtc = Number(fields[f].Value);
        break;
      default:
        console.warn(`Unknown field: ${fields[f].Name}`);
    }
  }
  if (tmp.dayUtc && tmp.minuteOfDayUtc) {
    const rxTime = new Date(meta.timestamp);
    const year = rxTime.getUTCFullYear();
    const month = rxTime.getUTCMonth(); //months from 0-11
    mobileMeta.locTimestamp = timestampFromMinuteDay(
      year, month, tmp.dayUtc, tmp.minuteOfDayUtc);
  }
  database.updateMobileMeta(mobileMeta);
  return notification(mobileMeta, message.Name);
}

/**
 * Parses response to query for last receive information
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
function parseModemLastRxInfo(message, meta) {
  let mobileMeta = { mobileId: meta.mobileId };
  const fields = message.Fields;
  let notifyMessage = notification(mobileMeta, message.Name);
  for (let f = 0; f < fields.length; f++) {
    switch (fields[f].Name) {
      case 'sipValid':
        notifyMessage.sipValid = fields[f].Value;
        break;
      case 'subframe':
        notifyMessage.subframe = fields[f].Value;
        break;
      case 'packets':
        notifyMessage.numSegmentsDetected = fields[f].Value;
        break;
      case 'packetsOK':
        notifyMessage.numSegmentsOk = fields[f].Value;
        break;
      case 'frequencyOffset':
        notifyMessage.frequencyOffset = fields[f].Value;
        break;
      case 'timingOffset':
        notifyMessage.timingOffset = fields[f].Value;
        break;
      case 'packetCNO':
        notifyMessage.segmentCn = fields[f].Value;
        break;
      case 'uwCNO':
        notifyMessage.uwCn = fields[f].Value;
        break;
      case 'uwRSSI':
        notifyMessage.uwRssi = fields[f].Value;
        break;
      case 'uwSymbols':
        notifyMessage.numUwSymbols = fields[f].Value;
        break;
      case 'uwErrors':
        notifyMessage.numUwErrors = fields[f].Value;
        break;
      case 'packetSymbols':
        notifyMessage.numSegmentSymbols = fields[f].Value;
        break;
      case 'packetErrors':
        notifyMessage.numSegmentErrors = fields[f].Value;
        break;
      default:
        console.warn(`Unknown field: ${fields[f].Name}`);
    }
  }
  console.log(`Modem last Rx info: ${JSON.stringify(notifyMessage)}`);
  return notifyMessage;
}

/**
 * Returns a string value of the metrics period, since it may not be an integer (e.g. 'partial minute' is non-specific)
 * @param {string | number} periodCode The period over which metrics were calculated by the modem
 * @returns {string}
 */
function getMetricsPeriod(periodCode) {
  let period = 'UNKNOWN';
  switch (periodCode) {
    case 0:
    case 'SinceReset':
      period = 'SinceReset';
      break;
    case 1:
    case 'LastPartialMinute':
      period = 'LastPartialMinute';
      break;
    case 2:
    case 'LastFullMinute':
      period = 'LastFullMinute';
      break;
    case 3:
    case 'LastPartialHour':
      period = 'LastPartialHour';
      break;
    case 4:
    case 'LastFullHour':
      period = 'LastFullHour';
      break;
    case 5:
    case 'LastPartialDay':
      period = 'LastPartialDay';
      break;
    case 6:
    case 'LastFullDay':
      period = 'LastFullDay';
      break;
    case 15:
    case 14:
    case 13:
    case 12:
    case 11:
    case 10:
    case 9:
    case 8:
    case 7:
    default:
      period = 'Reserved';
  }
  return period;
}

/**
 * Parses response to get receive metrics
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
function parseModemRxMetrics(message, meta) {
  let mobileMeta = { mobileId: meta.mobileId };
  const fields = message.Fields;
  let notifyMessage = notification(mobileMeta, message.Name);
  for (let f = 0; f < fields.length; f++) {
    switch (fields[f].Name) {
      case 'period':
        notifyMessage.metricsPeriod = getMetricsPeriod(Number(fields[f].Value));
        break;
      case 'numSegments':
        notifyMessage.numSegments = fields[f].Value;
        break;
      case 'numSegmentsOk':
        notifyMessage.numSegmentsOk = fields[f].Value;
        break;
      case 'AvgCN0':
        notifyMessage.avgCn = fields[f].Value;
        break;
      case 'SamplesCN0':
        notifyMessage.samplesCn = fields[f].Value;
        break;
      case 'ChannelErrorRate':
        notifyMessage.channelErrorRate = fields[f].Value;
        break;
      case 'uwErrorRate':
        notifyMessage.uwErrorRate = fields[f].Value;
        break;
      default:
        console.warn(`Unknown field: ${fields[f].Name}`);
    }
  }
  console.log(`Modem Rx metrics: ${JSON.stringify(notifyMessage)}`);
  return notifyMessage;
}

/**
 * Parses response to get transmit metrics
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
function parseModemTxMetrics(message, meta) {
  let mobileMeta = { mobileId: meta.mobileId };
  const fields = message.Fields;
  let notifyMessage = notification(mobileMeta, message.Name);
  let segmentDetails = {};
  for (let f = 0; f < fields.length; f++) {
    let fieldValue;
    if (fields[f].Type === 'array') {
      fieldValue = JSON.stringify(fields[f].Elements);
    } else {
      fieldValue = fields[f].Value;
    }
    switch (fields[f].Name) {
      case 'period':
        notifyMessage.metricsPeriod = getMetricsPeriod(fields[f].Value);
        break;
      case 'packetTypeMask':
        // TODO: build data structure for segment type arrays
        // bitmask definition dictates size of the 3 array fields following
        // 0: ack
        // 1: 0.5s @ 0.33 rate
        // 2: 0.5s @ 0.5 rate
        // 3: 0.5s @ 0.75 rate
        // 4: reserved
        // 5: 1s @ 0.33 rate
        // 6: 1s @ 0.5 rate
        segmentDetails.packetTypeMask = fields[f].Value;
        break;
      case 'txMetrics':
        segmentDetails.packetTypes = fields[f].Elements;
        break;
      default:
        console.warn(`Unknown field: ${fields[f].Name}`);
    }
  }
  notifyMessage.metrics = [];
  let bitmask = [];
  for (let b = 0; b < 8; b++) {
    bitmask[b] = (segmentDetails.packetTypeMask >> b) & 1;
  }
  let packetTypesIndex = 0;
  for (let i = 0; i < bitmask.length; i++) {
    if (bitmask[i] === 1) {
      let metric = {};
      switch (i) {
        case 0:
          metric.type = 'ack';
          break;
        case 1:
          metric.type = '0.5s subframe 0.33 rate';
          break;
        case 2:
          metric.type = '0.5s subframe 0.5 rate';
          break;
        case 3:
          metric.type = '0.5s subframe 0.75 rate';
          break;
        case 5:
          metric.type = '1s subframe 0.33 rate';
          break;
        case 6:
          metric.type = '1s subframe 0.5 rate';
          break;
        default:
          metric.type = 'undefined';
      }
      for (let e = 0; e < segmentDetails.packetTypes[packetTypesIndex].Fields.length; e++) {
        switch (segmentDetails.packetTypes[packetTypesIndex].Fields[e].Name) {
          case 'PacketsTotal':
            metric.segmentsTotal = segmentDetails.packetTypes[packetTypesIndex].Fields[e].Value;
            break;
          case 'PacketsSuccess':
            metric.segmentsOk = segmentDetails.packetTypes[packetTypesIndex].Fields[e].Value;
            break;
          case 'PacketsFailed':
            metric.segmentsFailed = segmentDetails.packetTypes[packetTypesIndex].Fields[e].Value;
            break;
        }
      }
      notifyMessage.metrics.push(metric);
      packetTypesIndex += 1;
    }
  }
  console.log(`Modem Tx metrics: ${JSON.stringify(notifyMessage)}`);
  return notifyMessage;
}

/**
 * Returns the converted pingTime field value from timestamp
 * @param {string} timestamp datestamp
 * @returns {number}
 */
function pingTime(timestamp) {
  let d;
  if (typeof (timestamp) === 'undefined') {
    d = new Date();
  } else {
    d = new Date(timestamp);
  }
  //console.debug(`returning ${d}`);
  return (d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()) % 65535;
}

/**
 * Parses a ping response to update the IdpMobiles collection metadata
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
function parseModemPingReply(message, meta) {
  let mobileMeta = { mobileId: msgMeta.mobileId };
  let latency = {};
  let requestTime, responseTime;
  let notifyMessage = notification(mobileMeta, message.Name);
  const receiveTime = pingTime(meta.timestamp);
  const fields = message.Fields;
  for (let f = 0; f < fields.length; f++) {
    vlog(logLevels.DEBUG, fName + ' Field Name: ' + fields[f].Name + ' | Field Value: ' + fields[f].Value);
    switch (fields[f].Name) {
      case 'requestTime':
        requestTime = Number(fields[f].Value);
        break;
      case 'responseTime':
        responseTime = Number(fields[f].Value);
        break;
      default:
        console.warn(`Unknown field: ${fields[f].Name}`);
    }
  }

  if (responseTime < requestTime) {
    responseTime += 65535;
    if (responseTime > 86399) { responseTime -= 86400 }
  }
  latency.mobileTerminated = responseTime - requestTime;
  if (receiveTime < responseTime) {
    receiveTime += 65535;
    if (receiveTime > 86399) { receiveTime -= 86400 }
  }
  latency.mobileOriginated = receiveTime - responseTime;
  latency.roundTrip = latency.mobileTerminated + latency.mobileOriginated;

  notifyMessage.requestTime = requestTime;
  notifyMessage.responseTime = responseTime;
  notifyMessage.receiveTime = receiveTime;
  notifyMessage.latency = latency;
  return notifyMessage;
}

/**
 * Parses request from modem for network ping response (note: response is automatically generated by the network)
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
function parseNetworkPingRequest(message, meta) {
  let mobileMeta = { mobileId: meta.mobileId };
  const fields = message.Fields;
  let requestTime;
  let notifyMessage = notification(mobileMeta, message.Name);
  const receiveTime = pingTime(meta.timestamp);
  for (let f = 0; f < fields.length; f++) {
    switch (fields[f].Name) {
      case 'requestSent':
        requestTime = Number(fields[f].Value);
        notifyMessage.requestTime = requestTime;
        notifyMessage.latency = receiveTime - requestTime;
        break;
      default:
        console.warn(`Unknown field: ${fields[f].Name}`);
    }
  }
  return notifyMessage;
}

/**
 * Parses request from modem for network ping response (note: response is automatically generated by the network)
 * @private
 * @param {MessagePayload} message JSON Payload structure
 * @param {MessageMetadata} meta Metadata including mobileId, timestamp, [topic]
 * @returns {Object} notification message
 */
function parseModemBroadcastIds(message, meta) {
  let mobileMeta = { mobileId: meta.mobileId };
  const fields = message.Fields;
  let broadcastIds = [];
  for (let f = 0; f < fields.length; f++) {
    switch (fields[f].Name) {
      case 'broadcastIDs':
        for (var e = 0; e < fields[f].Elements.length; e++) {
          for (var ef = 0; ef < fields[f].Elements[e].Fields.length; ef++) {
            broadcastIds.push(fields[f].Elements[e].Fields[ef].Value);
          }
        }
        break;
      default:
        console.warn(`Unknown field: ${fields[f].Name}`);
    }
  }
  console.log(`BroadcastIds: ${broadcastIds}`);
  mobileMeta.broadcastIds = JSON.stringify(broadcastIds);
  database.updateMobileMeta(mobileMeta);
  return notification(mobileMeta, message.Name);
}

// Mobile-Terminated (aka Forward) Message Parsers

/**
 * @typedef ForwardMessage
 * @property {string} DestinationID
 * @property {string} UserMessageID
 * @property {number[]} RawPayload
 * @property {Message} Payload
 */

/**
 * Encodes the modem reset message based on the reset type
 * @param {string | number} resetType
 * @return {Object} Message and raw payload number array
 */
function encodeModemReset(resetType) {
  if (typeof (resetType) === 'undefined') {
    resetType = 'modemPreserve';
  }
  let payload = {
    IsForward: true,
    SIN: 0,
    MIN: 68,
    Name: 'Reset',
    Fields: []
  };
  switch (resetType) {
    case 0:
    case 'modemPreserve':
      resetType = 0;
      break;
    case 1:
    case 'modemFlush':
      resetType = 1;
      break;
    case 2:
    case 'termnal':
      resetType = 2;
      break;
    case 3:
    case 'TerminalModemFlush':
      resetType = 3;
      break;
    default:
      vlog(logLevels.ERROR, fName + ' invalid resetType ' + resetType);
      resetType = 0;
  }
  let field = {
    'Name': 'resetType',
    'Value': resetType.toString(),
    'Type': 'enum'
  };
  payload.Fields.push(field);
  //var rawPayload = [0, 68, resetType];
  return payload;
}

function encodeModemSetWakeupPeriod(interval) {
  console.warn('Feature not implemented');
  const wakeupIntevals = [];
  if (interval in wakeupIntevals) {
    // TODO something
  }
}

function encodeModemMute(muteFlag) {
  console.warn('Feature not implemented');

}

/**
 * Returns payload for location request
 * @returns {Object} payload
 */
function encodeModemPositionRequest() {
  const payload = {
    "SIN": 0,
    "MIN": 72,
    "Name": "getLocation",
    "IsForward": true,
    "Fields": []
  };
  return payload;
}

/**
 * Returns payload to get modem configuration
 * @returns {Object} payload
 */
function encodeModemGetConfiguration() {
  const payload = {
    IsForward: true,
    Name: 'getConfiguration',
    SIN: 0,
    MIN: 97,
    Fields: []
  };
  //const rawPayload = [0, 97];
  return payload;
}

function encodeModemGetLastRxInfo() {
  console.warn('Feature not implemented');
}

function encodeModemGetRxMetrics(metricsPeriod) {
  console.warn('Feature not implemented');
}

function encodeModemGetTxMetrics(metricsPeriod) {
  console.warn('Feature not implemented');
}

/**
 * Returns payload for a modem ping request
 * @returns {Object} payload
 */
function encodeModemPing() {
  let payload = {
    Name: 'pingModem',
    IsForward: true,
    SIN: 0,
    MIN: 112,
    Fields: []
  };
  var requestTime = pingTime();
  var field = {
    'Name': 'requestTime',
    'Value': requestTime.toString(),
    'Type': 'unsignedInt'
  };
  payload.Fields.push(field);
  // TODO: calculate requestTime for rawPayload
  //var rawPayload = [0, 115];
  return payload;
}

function encodeModemGetBroadcastIds() {
  var message = {
    IsForward: true,
    SIN: 0,
    MIN: 115,
    Name: 'requestBroadcastIds',
  };
  var rawPayload = [0, 115];
  return { message, rawPayload };
}

module.exports = {
  parseCoreModem,
  commandMessages: {
    modemReset: encodeModemReset(),
    getLocation: encodeModemPositionRequest(),
    getConfiguration: encodeModemGetConfiguration(),
    pingModem: encodeModemPing(),
  }
};