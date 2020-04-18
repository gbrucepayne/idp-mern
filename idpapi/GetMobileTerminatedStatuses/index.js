//GetMobileTerminatedStatuses

const idpApi = require('isatdatapro-api');
//const idpApi = require('../../isatdatapro-api/lib/api-v1');

module.exports = async function (context, timer) {
  const callTime = new Date().toISOString();
  const database = require('../database/database');
  await database.initializeDatabase();

  /**
   * Retreives Mobile-Terminated statuses and updates a database
   * @param {Object} auth Mailbox credentials
   * @param {Object} filter Set of retrieval filter criteria
   */
  async function getStatuses(mailbox) {
    const nativeApiCall = 'get_forward_statuses';
    // TODO (Geoff) add function to idpApi to return the native Inmarsat call
    const idpGateway = await database.getMailboxGateway(mailbox);
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
      accessId: mailbox.accessId,
      operation: nativeApiCall,
      gatewayUrl: idpGateway,
      highWatermark: filter.startTimeUtc,
    };
    context.log(`Getting status for messages ${JSON.stringify(filter)}`);
    await Promise.resolve(idpApi.getMobileTerminatedStatuses(auth, filter, idpGateway))
    .then(async function (result) {
      apiCallLog.errorId = result.ErrorID;
      if (result.ErrorID !== 0) {
        let errorDesc = await idpApi.getErrorName(result.ErrorID);
        context.log(`ERROR: ${errorDesc}`);
        apiCallLog.success = false;
        apiCallLog.errorDesc = errorDesc;
      } else {
        apiCallLog.success = true;
        if (result.NextStartUTC !== '') {
          apiCallLog.NextStartUTC = result.NextStartUTC;
        }
        if (result.Statuses !== null) {
          context.log(`Retrieved ${result.Statuses.length} statuses`);
          apiCallLog.messageCount = result.Statuses.length;
          for (let s=0; s < result.Statuses.length; s++) {
            let status = result.Statuses[s];
            //context.log(`Processing status for ${status.ForwardMessageID}`);
            if (status.ErrorID !== 0) {
              status.errorDescription = await idpApi.getErrorName(status.ErrorID);
            }
            status.stateDesc = idpApi.getMtStateDef(status.State);
            await database.updateMobileTerminatedMessages(status);
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
    context.log('GetMobileTerminatedStatuses timer past due!');
  }
  context.log('GetMobileTerminatedStatuses timer triggered at', callTime);
  
  try {
    const mailboxes = await database.getMailboxes();
    for (let i = 0; i < mailboxes.length; i++) {
      let activeMailbox = mailboxes[i];
      /*  TODO (Geoff) remove or create this as a filter option
      let auth = {
        accessId: activeMailbox.accessId,
        password: activeMailbox.password
      };
      let filter = {};
      filter.ids = await database
        .getOpenMobileTerminatedIds(activeMailbox.accessId);
      //TODO get statuses without filter to check if any messages submitted not in database
      if (filter.ids.length > 0) {
        await getStatuses(auth, filter);
      } else {
        context.log(`No open messages for mailbox ${auth.accessId}`);
      }
      */
      await getStatuses(activeMailbox);
    }
  } catch (err) {
    context.log(err);
    throw err;
  } finally {
    await database.close();
  }

};