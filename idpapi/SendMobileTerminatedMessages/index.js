const idpApi = require('isatdatapro-api');
//const idpApi = require('../../isatdatapro-api/lib/api-v1');
const codec = require('../codec/modemMessageParser');

module.exports = async function (context, req) {
  const database = require('../database/database');
  context.log(`SendMobileTerminatedMessages triggered by HTTP request`);
  await database.initializeDatabase();

  async function sendMessage(message) {
    const mailbox = await database.getMobileMailbox(message.DestinationID);
    let idpGateway = await database.getMailboxGateway(mailbox);
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
              context.log(`Message ID ${submission.ForwardMessageID} assigned`);
              forwardId = submission.ForwardMessageID;
              let d = new Date();
              // Apply a "submitted to gateway" timestamp
              submission.MessageUTC = idpApi.dateToIdpTime(d);
              submission.accessId = auth.accessId;
              //Starting state IsClosed flag clear for subsequent MT status check
              submission.IsClosed = false;
              await database.updateMobileTerminatedMessages(submission);
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
    context.log(err);
    throw err;
  } finally {
    await database.close();
  }
};