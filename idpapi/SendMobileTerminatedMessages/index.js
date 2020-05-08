const idpApi = require('isatdatapro-api');
//const idpApi = require('../../isatdatapro-api/lib/api-v1');
const codec = require('../codec/modemMessageParser');
const DataHandler = require('../database/dataHandler');

module.exports = async function (context, req) {
  const thisFunction = {name: 'SendMobileTerminatedMessages'};
  context.log(`${thisFunction.name} triggered by HTTP request`);
  const database = new DataHandler();
  await database.initialize();
  let apiOutageCatch = '';

  async function sendMessage(message) {
    const mailbox = await database.getMobileMailbox(message.DestinationID);
    let idpGateway = await database.getMailboxGateway(mailbox);
    apiOutageCatch = idpGateway;
    const auth = {
      accessId: mailbox.accessId,
      password: mailbox.password
    };
    let forwardId = null;
    let apiCallLog = {
      category: 'apiCallLog',
      callTime: new Date().toISOString(),
      accessId: auth.accessId,
      operation: 'submit_forward_messages',
      gatewayUrl: idpGateway,
      messageCount: 1,
    };
    await Promise.resolve(idpApi.submitMobileTerminatedMessages(auth, [message], idpGateway))
    .then(async function (result) {
      let apiRecovered = await database.updateApiAlive(idpGateway, true);
      if (apiRecovered) {
        context.log(`API recovered for ${idpGateway}`);
        // TODO notify recovery
      }
      context.log(`submitMT result: ${JSON.stringify(result)}`);
      apiCallLog.errorId = result.ErrorID;
      if (result.ErrorID !== 0) {
        let errorDesc = await idpApi.getErrorName(result.ErrorID);
        context.log(`API error: ${errorDesc}`);
        apiCallLog.success = false;
        apiCallLog.errorDesc = errorDesc;
      } else {
        apiCallLog.success = true;
        if (result.Submissions.length > 0) {
          for (let s = 0; s < result.Submissions.length; s++) {
            let submission = result.Submissions[s];
            if (submission.ErrorID !== 0) {
              let errorDesc = await idpApi.getErrorName(result.ErrorID);
              context.log(`Submission error: ${errorDesc}`);
              apiCallLog.success = false;
              apiCallLog.errorDesc = errorDesc;
            } else {
              //context.log(`Message ID ${submission.ForwardMessageID} assigned`);
              forwardId = submission.ForwardMessageID;
              let serviceIdNumber;
              if (message.Payload) {
                serviceIdNumber = message.Payload.SIN;
              } else {
                serviceIdNumber = message.RawPayload[0];
              }
              submission.serviceIdNumber = serviceIdNumber;
              let d = new Date();
              // Apply a "submitted to gateway" timestamp
              submission.MessageUTC = idpApi.dateToIdpTime(d);
              submission.accessId = auth.accessId;
              submission.State = 0;
              submission.stateDesc = idpApi.getMtStateDef(submission.State);
              //Starting state IsClosed flag clear for subsequent MT status check
              submission.IsClosed = false;
              await database.updateMobileTerminatedMessages(submission);
              // ******************** UAV ONLY ***********************************
              if (serviceIdNumber === 128) {
                await database.updateUavForwardMessages(submission);
              }
              // *****************************************************************
            }
            let mobileMeta = {
              mobileId: message.DestinationID,
              wakeupPeriod: submission.TerminalWakeupPeriod,
            };
            await database.updateMobileMeta(mobileMeta);
          }
        } else {
          context.log(`No submission accepted`);
        }
      }
    })
    .catch(err => {
      //TODO: handle promise error more elegantly
      // e.g. alert on API non-response or 500
      throw err;
    });
    await database.updateApiCallLogs(apiCallLog);
    return forwardId;
  }

  try {
    if (req.query && req.query.mobileId && req.query.cmd) {
      if (req.query.cmd in codec.commandMessages) {
        let message = {
          DestinationID: req.query.mobileId,
          Payload: codec.commandMessages[req.query.cmd]
        };
        if (req.query.userMessageId) message.UserMessageID = res.query.userMessageId;
        let forwardId = await sendMessage(message);
        console.log(`Sent ${req.query.cmd} as message ${forwardId}`);
        /*
        context.res = {
          status: 200,
          body: `Submitted ${req.query.cmd} as Message ID ${forwardId}`
        };
        */
      } else {
        let helper = [];
        for (key in codec.commandMessages) {
          helper.push(key);
        }
        /*
        context.res = {
          status: 400,
          body: `Unsupported command: ${req.query.cmd}, try: ${helper}`
        }
        */
      }
    } else if (req.body && req.body.mobileId) {
      let message = { DestinationID: req.body.mobileId };
      if (req.body.messageId) message.UserMessageID = res.query.messageId;
      // TODO check for byte array or base64 or Payload structure
    }
    else {
      let errMsg = 'Please pass a Mobile ID and command on the query string, or include the request body';
      context.log(errMsg);
      /*
      context.res = {
        status: 400,
        body: "Please pass a Mobile ID and command on the query string, or include the request body"
      };
      */
    }
  } catch (err) {
    switch(err.message) {
      case 'HTTP 502':
        let newOutage = await database.updateApiAlive(apiOutageCatch, false);
        if (newOutage) {
          context.warn(`${thisFunction.name}: API server error for ${apiOutageCatch}`);
          // TODO: notify
        } else {
          context.warn(`${thisFunction.name}:API still down at ${apiOutageCatch}`);
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