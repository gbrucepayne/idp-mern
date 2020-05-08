// GetMobileOriginatedMessages
'use strict';

const idpApi = require('isatdatapro-api');
const codec = require('../codec/modemMessageParser');
const uav = require('../codec/uavPoc');
//const idpApi = require('../../isatdatapro-api/lib/api-v1');
const DataHandler = require('../database/dataHandler');

/**
 * Fetches new mobile-originated messages, stores by unique ID and maintains
 * API high water mark metadata
 * @param {object} context
 * @param {object} timer
 */
module.exports = async function (context, timer) {
  const thisFunction = {name: 'GetMobileOriginatedMessages'};
  const callTime = new Date().toISOString();
  const database = new DataHandler();
  await database.initialize();
  let apiOutageCatch = '';

  /**
   * Retreives Mobile-Originated messages and stores unique ones in a database
   * Also logs API calls in a database and uses for high water mark retrieval
   * @param {Object} auth Mailbox credentials
   * @param {Object} filter Set of retrieval filter criteria
   */
  async function getMessages(mailbox) {
    const nativeApiCall = 'get_return_messages';
    // TODO (Geoff) add function to idpApi to return the native Inmarsat call
    const idpGateway = await database.getMailboxGateway(mailbox);
    apiOutageCatch = idpGateway;
    const auth = {
      accessId: mailbox.accessId,
      password: mailbox.password,
    };
    let filter = await database.getApiFilter(mailbox, nativeApiCall);
    if (filter.startTimeUtc) {
      if (typeof(filter.startTimeUtc) === 'string' || filter.startTimeUtc instanceof Date)
      filter.startTimeUtc = idpApi.dateToIdpTime(filter.startTimeUtc);
    }
    let apiCallLog = {
      category: 'apiCallLog',
      callTime: new Date().toISOString(),
      accessId: auth.accessId,
      operation: nativeApiCall,
      gatewayUrl: idpGateway,
      highWatermark: filter.startTimeUtc,
    };
    //console.log(`Get MO messages with ${JSON.stringify(filter)}`);
    await Promise.resolve(idpApi.getMobileOriginatedMessages(auth, filter, idpGateway))
    .then(async function (result) {
      let apiRecovered = await database.updateApiAlive(idpGateway, true);
      if (apiRecovered) {
        context.log(`${thisFunction.name}: API recovered for ${idpGateway}`);
        // TODO notify recovery
      }
      apiCallLog.errorId = result.ErrorID;
      if (result.ErrorID !== 0) {
        let errorDesc = await idpApi.getErrorName(result.ErrorID);
        context.log(`ERROR: ${errorDesc}`);
        apiCallLog.success = false;
        apiCallLog.errorDesc = errorDesc;
      } else {
        apiCallLog.success = true;
        if (result.NextStartUTC !== '') {
          apiCallLog.nextStartUtc = result.NextStartUTC;
        } else {
          apiCallLog.nextStartUtc = idpApi.dateToIdpTime(callTime);
        }
        apiCallLog.nextStartId = result.NextStartID;
        if (result.Messages !== null) {
          apiCallLog.messageCount = result.Messages.length;
          console.log(`Retrieved ${result.Messages.length} messages`);
          for (let m = 0; m < result.Messages.length; m++) {
            let message = result.Messages[m];
            message.accessId = auth.accessId;
            /*
            context.log(`Processing Mobile Originated message ${message.ID}
                          from ${message.MobileID}`);
            // */
            let newMessage = await database.updateMobileOriginatedMessages(message);
            if (newMessage) {
              let mobileMeta = {
                category: 'mobile',
                mobileId: message.MobileID,
                accessId: auth.accessId,
                lastMessageReceived: message.ReceiveUTC,
                lastSatelliteRegion: message.RegionName,
              };
              context.log(`Adding message ${message.ID} to database`);
              await database.updateMobileMeta(mobileMeta);
              if (message.SIN === 0) {
                let notifyMessage = codec.parseCoreModem(message);
                context.log(`NOTIFICATION: ${JSON.stringify(notifyMessage)}`);
              } else if (message.SIN === 15) {
                context.log(`WARNING suspected firmware lock on 
                  ${mobileMeta.mobileId}`);
              } else if (message.SIN === 128) {
                context.log(`Processing potential UAV POC data`);
                let notifyMessage = uav.parseUav(message);
                context.log(`UAV: ${JSON.stringify(notifyMessage)}`);
              } else {
              context.log(`Parsing not defined for SIN=${message.SIN}`);
              }
            } else {
              context.log(`Message ${message.ID} already in database`);
            }
          }
          // TODO: test this, probably against Modem Simulator
          if (result.More) {
            filter.startMessageId = result.NextStartID;
            getMessages(auth, filter);
          }
        } else {
          context.log(`No messages to retrieve from Mailbox ${auth.accessId}`);
        }
      }
    })
    .catch(err => {
      //TODO: handle promise error more elegantly
      // e.g. alert on API non-response or 500
      throw err;
    });
    await database.updateApiCallLogs(apiCallLog);
  }

  try {
    if (timer.IsPastDue) {
      context.log(`${thisFunction.name} timer past due!`);
    }
    context.log(`${thisFunction.name} timer triggered at ${callTime}`);
  
    const mailboxes = await database.getMailboxes();
    for (let i = 0; i < mailboxes.length; i++) {
      let activeMailbox = mailboxes[i];
      await getMessages(activeMailbox);
    }
  } catch (err) {
    switch(err.message) {
      case 'HTTP 502':
        let newOutage = await database.updateApiAlive(apiOutageCatch, false);
        if (newOutage) {
          context.warn(`${thisFunction.name}: API server error for ${apiOutageCatch}`);
          // TODO: notify
        } else {
          context.warn(`${thisFunction.name}: API still down at ${apiOutageCatch}`);
        }
        break;
      default:
        context.error(err);
        throw err;
    }
  } finally {
    await database.close();
  }
};