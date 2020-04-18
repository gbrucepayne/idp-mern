const getMobileOriginated = require('./GetMobileOriginatedMessages/index');
const sendMobileTerminated = require('./SendMobileTerminatedMessages/index');
const getMobileTerminatedStatuses = require('./GetMobileTerminatedStatuses/index');

const MO_INTERVAL = 1 * 1000
const timer = { IsPastDue: false };
const MT_INTERVAL = 1 * 1000;

setTimeout(function() {getMobileOriginated(console, timer)}, MO_INTERVAL);
//setTimeout(function() {getMobileTerminatedStatuses(console, timer)}, MT_INTERVAL);
/*
let req = {
  query: {
    mobileId: '01174907SKYFDA4',
    cmd: 'getLocation',
  },
};
sendMobileTerminated(console, req);
*/
//TODO some way of routing from web front-end to send Message
