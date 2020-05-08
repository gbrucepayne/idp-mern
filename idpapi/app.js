const getMobileOriginated = require('./GetMobileOriginatedMessages/index');
//const sendMobileTerminated = require('./SendMobileTerminatedMessages/index');
//const getMobileTerminatedStatuses = require('./GetMobileTerminatedStatuses/index');

const MO_INTERVAL = 10 * 1000;
const timer = { IsPastDue: false };
const MT_INTERVAL = 10 * 1000;
///*
getMobileOriginated(console, timer);
setInterval(function() {getMobileOriginated(console, timer)}, MO_INTERVAL);
// */
/*
setTimeout(function() {
  let req = {
    query: {
      //mobileId: '01174907SKYFDA4',
      mobileId: '01459442SKY0EF7',
      cmd: 'pingModem',
    },
  };
  sendMobileTerminated(console, req);
}, MO_INTERVAL + 1000);
// */
/*
getMobileTerminatedStatuses(console, timer);
setInterval(function() {
  getMobileTerminatedStatuses(console, timer);
}, MT_INTERVAL);
// */
//TODO some way of routing from web front-end to send Message
