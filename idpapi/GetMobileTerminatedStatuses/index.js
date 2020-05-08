//GetMobileTerminatedStatuses

const idpApi = require('isatdatapro-api');
//const idpApi = require('../../isatdatapro-api/lib/api-v1');
const DataHandler = require('../database/dataHandler');

module.exports = async function (context, timer) {
  const thisFunction = {name: 'GetMobileTerminatedStatuses'};
  const callTime = new Date().toISOString();
  const database = new DataHandler();
  await database.initialize();
  let apiOutageCatch = '';

  /**
   * Retreives Mobile-Terminated statuses and updates a database
   * @param {Object} auth Mailbox credentials
   * @param {Object} filter Set of retrieval filter criteria
   */
  async function getStatuses(mailbox) {
    const nativeApiCall = 'get_forward_statuses';
    // TODO (Geoff) add function to idpApi to return the native Inmarsat call
    const idpGateway = await database.getMailboxGateway(mailbox);
    apiOutageCatch = idpGateway;
    const auth = {
      accessId: mailbox.accessId,
      password: mailbox.password,
    };
    context.debug(`Checking mailbox ${mailbox.accessId} open MT messages`);
    let filter = await database.getApiFilter(mailbox, nativeApiCall);
    if (filter.startTimeUtc) {
      if (typeof(filter.startTimeUtc) === 'string' || filter.startTimeUtc instanceof Date)
      filter.startTimeUtc = idpApi.dateToIdpTime(filter.startTimeUtc);
    }
    let apiCallLog = {
      category: 'apiCallLog',
      callTime: new Date().toISOString(),
      accessId: mailbox.accessId,
      operation: nativeApiCall,
      gatewayUrl: idpGateway,
      highWatermark: filter.startTimeUtc,
    };
    //context.log(`Getting status for messages ${JSON.stringify(filter)}`);
    await Promise.resolve(idpApi.getMobileTerminatedStatuses(auth, filter, idpGateway))
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
        if (result.Statuses !== null && result.Statuses.length > 0) {
          context.log(`Retrieved ${result.Statuses.length} statuses for mailbox ${mailbox.accessId}`);
          apiCallLog.messageCount = result.Statuses.length;
          for (let s=0; s < result.Statuses.length; s++) {
            let status = result.Statuses[s];
            let inDb = await database.isMessageInDatabase(status);
            if (!inDb) {
              context.warn(`Mobile Terminated message ${status.ForwardMessageID} not found in database`);
              //TODO if FowardID not in database, get Forward message (somebody else sent one)
            }
            if (status.ErrorID !== 0) {
              status.errorDescription = await idpApi.getErrorName(status.ErrorID);
            }
            status.stateDesc = idpApi.getMtStateDef(status.State);
            let newStatus = await database.updateMobileTerminatedMessages(status);
            if (newStatus) {
              //TODO get messageMeta, notify if relevant
            }
            // ***** UAV TESTING ONLY REMOVE ****************************************
            let uavUpdate = await database.updateUavForwardMessages(status);
            if (uavUpdate) {
              if (status.State === 1) {
                //TODO calculate latency
              }
              context.log(`Updated UAV forward message ${status.ForwardMessageID}`)
            }
            // **********************************************************************
          }
          // TODO: should be redundant if filtering on message ID
          if (result.More) {
            filter = {
              startTimeUtc: result.NextStartUTC
            };
            await getStatuses(auth, filter);
          }
        } else {
          context.log(`No Statuses to retriveve from Mailbox ${auth.accessId}`);
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

  if (timer.IsPastDue) {
    context.log(`${thisFunction.name} timer past due!`);
  }
  context.log(`${thisFunction.name} timer triggered at ${callTime}`);
  
  try {
    const mailboxes = await database.getMailboxes();
    for (let i = 0; i < mailboxes.length; i++) {
      let activeMailbox = mailboxes[i];
      await getStatuses(activeMailbox);
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