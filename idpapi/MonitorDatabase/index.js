//MonitorDatabase

const config = require('./config.json');
const database = require('../database/database');
const modemParser = require('../codec/modemMessageParser');
const notify = require('../notification/notification');

module.exports = async function (context, documents) {
  if (!!documents && documents.length > 0) {
    //context.log(`Cosmos update: Documents ${JSON.stringify(documents, null, 2)}`);
    for (let d = 0; d < documents.length; d++) {
      let document = documents[d];

      // Trim maximum number of apiCallLogs
      if (document.category === "apiCallLog") {
        database.maintainApiCallLogs(config.maxApiCallLogs);
      } else if (document.category === 'messageMobileOriginated') {
        context.log(`New MO message ${document.ID} inserted in database`);
        if ('Payload' in document) {
          if (document.Payload.SIN === 0) {
            context.log(`Processing modem telemetry ${document.Payload.Name}`);
            const telemetry = modemParser.parseCoreModem(document);
            if (telemetry !== undefined) {
              notify(telemetry);
            }
          } else if (document.Payload.SIN === 15
            && document.Payload.MIN === 255) {
            context.log(`WARNING: Modem ${document.MobileID} is vendor locked`)
          } else {
            context.log(`Unhandled processing for SIN ${document.Payload.SIN} 
                            MIN ${document.Payload.MIN}`);
          }
        } else {
          let sin = document.RawPayload[0];
          let min = document.RawPayload[1];
          context.log(`Unhandled processing for SIN ${sin} MIN ${min}`);
        }
      } else if (document.category === 'messageMobileTerminated') {
        if (document.IsClosed) {
          if (document.State !== 1) {
            context.log(`Mobile-Terminated message 
                            ${document.ForwardMessageID} FAILED`);
          } else {
            context.log(`Mobile-Terminated Message 
                            ${document.ForwardMessageID} SUCCESS`);
          }
        }
      }
    }
  }
}
