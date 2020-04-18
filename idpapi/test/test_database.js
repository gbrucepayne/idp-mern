const db = require('../database/database');

/*
(async () => {
  try {
    const mailboxes = await db.query('SELECT * FROM mailboxes');
    console.log(`Mailboxes: ${JSON.stringify(mailboxes, null, 2)}`);
  } catch (err) {
    throw err;
  } finally {
    await db.end();
  }
})()
*/

const testMsgPayload = {
  "messageId":37730177,
  "messageUtc":"2020-04-16 20:39:50",
  "receiveUtc":"2020-04-16 20:39:50",
  "serviceIdNumber":0,
  "mobileId":"01174907SKYFDA4",
  "rawPayload":{"type":"Buffer","data":[0,72,1,41,117,176,221,71,127,0,89,0,0,132,215]},
  "payload":{
    "Name":"replyPosition",
    "SIN":0,
    "MIN":72,
    "Fields":[
      {"Name":"fixStatus","Value":"1","Type":"unsignedint"},
      {"Name":"latitude","Value":"2717104","Type":"signedint"},
      {"Name":"longitude","Value":"-4550914","Type":"signedint"},
      {"Name":"altitude","Value":"89","Type":"signedint"},
      {"Name":"speed","Value":"0","Type":"unsignedint"},
      {"Name":"heading","Value":"0","Type":"unsignedint"},
      {"Name":"dayOfMonth","Value":"16","Type":"unsignedint"},
      {"Name":"minuteOfDay","Value":"1239","Type":"unsignedint"}
    ]
  },
  "regionName":"AMERRB16",
  "otaMessageSize":15,
  "accessId":"MB141",
  "category":"messageMobileOriginated",
  "ttl":90
}

let newId = db.createItem(testMsgPayload);

/*
const MOBILE_ID = '01174907SKYFDA4';
(async () => {
  try {
    const mailboxes = await db.getMailboxes();
    console.log(`Mailboxes: ${JSON.stringify(mailboxes, null, 2)}`);
    const mailbox = await db.getMobileMailbox(`${MOBILE_ID}`);
    console.log(`Mailbox for ${MOBILE_ID}: ${mailbox}`);
  } catch (err) {
    throw err;
  } finally {
    await db.close();
  }
})()
*/