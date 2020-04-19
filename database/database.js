// Wraps mysql with promisify for query and end
// TODO: JSDoc

const mysql = require('mysql');
const util = require('util');

const dbConfig = require('./config/local');

const conn = mysql.createConnection({
  host: dbConfig.host,
  user: dbConfig.user,
  password: dbConfig.password,
});

const connect = util.promisify(conn.connect).bind(conn);
const query = util.promisify(conn.query).bind(conn);
const end = util.promisify(conn.end).bind(conn);

const CATEGORIES = {
  api_call: {
    getMobileOriginated: 'get_return_messages',
    sendMobileTerminated: 'submit_messages',
    getMobileTerminatedStatus: 'get_forward_statuses',
    cancelMobileTerminated: 'submit_cancelations',
  },
  api_gateway: 'api_gateway',
  mailbox: 'mailbox',
  mobile: 'mobile',
  message: {
    return: 'mobile_originated',
    forward: 'mobile_terminated',
  },
};

const API_MAP = {
  // Native API : database column
  getMobileOriginatedMessages: {
    'table': 'api_call',
    'operation': 'get_return_messages',
    'ErrorID': 'error_id',
    'NextStartUTC': 'next_start_utc',
    'NextStartID': 'next_start_id',
    'More': 'more',
  },
  MessageMobileOriginated: {
    'table': 'message_return',
    'ID': 'message_id',
    'MessageUTC': 'mailbox_receive_time',
    'ReceiveUTC': 'satellite_receive_time',
    'RegionName': 'satellite_region',
    'SIN': 'codec_service_id',
    'MIN': 'codec_message_id',
    'Name': 'codec_name',
    'MobileID': 'mobile_id',
    'OTAMessageSize': 'size',
    'RawPayload': 'payload_blob',
    'Payload': 'payload_json',
  },
  submitMobileTerminatedMessages: {
    'table': 'api_call',
    'operation': 'submit_messages',
    'ErrorID': 'error_id',
  },
  getMobileTerminatedMessages: {
    'table': 'api_call',
    'operation': 'get_forward_messages',
    'ErrorID': 'error_id',
  },
  getMobileTerminatedStatuses: {
    'table': 'api_call',
    'operation': 'get_forward_statuses',
    'ErrorID': 'error_id',
    'NextStartUTC': 'next_start_utc',
    'More': 'more',
  },
  // MessageMobileTerminated applies to forward messages and statuses
  MessageMobileTerminated: {
    'table': 'message_forward',
    'DestinationID': 'mobile_id',
    'ForwardMessageID': 'message_id',
    'OTAMessageSize': 'size',
    'StateUTC': 'state_time',
    // StateUTC for get_forward_statuses and StatusUTC for get_forward_messages?
    // 'StatusUTC': 'state_time',
    'ErrorID': 'error_id',
    'UserMessageID': 'user_message_id',
    'ScheduledSendUTC': 'scheduled_send_time',
    'TerminalWakeupPeriod': 'wakeup_period',
    'IsClosed': 'closed',
    'State': 'state_code',
    'ErrorID': 'error_id',
    // next set are returned by get_forward_messages
    'CreateUTC': 'submit_time',
    'ReferenceNumber': 'reference_number',
    'SIN': 'codec_service_id',
    'MIN': 'codec_message_id',
    'IsForward': 'codec_is_forward',
    'Name': 'codec_name',
    'RawPayload': 'payload_blob',
    'Payload': 'payload_json',
  },
  getMobileInfo: {
    'ID': 'id',
    'Description': 'description',
    'LastRegistrationUTC': 'last_registration_time',
    'RegionName': 'satellite_region',
  },
  getBroadcastInfo: {
    'ID': 'id',
    'Description': 'description',
  },
};

const SCHEMA = {
  api_call: [
    'id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY(id)',
    '_ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    'category VARCHAR(25) DEFAULT NULL',
    'operation VARCHAR(45) NOT NULL',
    'success BOOLEAN NOT NULL',
    'call_time VARCHAR(45) NOT NULL',
    'gateway_url VARCHAR(45) DEFAULT NULL',
    'mailbox_id VARCHAR(45) DEFAULT NULL',
    'access_id VARCHAR(25) DEFAULT NULL',
    'error_id INT DEFAULT NULL',
    'error_description VARCHAR(45) DEFAULT NULL',
    'next_start_id INT DEFAULT NULL',
    'next_start_utc VARCHAR(25) DEFAULT NULL',
    'high_watermark VARCHAR(25) DEFAULT NULL',
    'message_count INT DEFAULT 0',
    'ttl INT DEFAULT NULL',
  ],
  api_gateway: [
    'id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY(id)',
    'category VARCHAR(25) DEFAULT NULL',
    'name VARCHAR(25) NOT NULL',
    'url VARCHAR(100) NOT NULL',
  ],
  mailbox: [
    'id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY(id)',
    'category VARCHAR(25) DEFAULT "mailbox"',
    'description VARCHAR(25) NOT NULL',
    'api_gateway_name VARCHAR(25) NOT NULL',
    // mailbox_id could be different format on different message gateways
    'mailbox_id VARCHAR(25) NOT NULL',
    'access_id VARCHAR(25) NOT NULL',
    'password VARCHAR(25) NOT NULL',
    'message_definition_file BLOB DEFAULT NULL',
  ],
  mobile: [
    // Use Mobile ID as primary key as globally unique
    'id VARCHAR(15) NOT NULL, PRIMARY KEY(id)',
    'category VARCHAR(25) DEFAULT "mobile"',
    'description VARCHAR(50) DEFAULT ""',
    'mailbox_id VARCHAR(25) NOT NULL',
    'last_message_received_time TIMESTAMP DEFAULT NULL',
    'modem_hardware_version VARCHAR(10) DEFAULT NULL',
    'modem_firmware_version VARCHAR(10) DEFAULT NULL',
    'modem_product_id VARCHAR(10) DEFAULT NULL',
    'last_registration_time TIMESTAMP DEFAULT NULL',
    'registration_region VARCHAR(25) DEFAULT NULL',
    'wakeup_period INT DEFAULT 0',
    'broadcast_id_list VARCHAR(256) DEFAULT NULL',
    'modem_type VARCHAR(25) DEFAULT NULL',
    'asset_type VARCHAR(50) DEFAULT NULL',
    'location JSON DEFAULT NULL',
  ],
  message_return: [
    // id not using gateway assigned messaging id due to possible overlap
    'id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY(id)',
    'category VARCHAR(25) DEFAULT "message_mobile_originated"',
    'mobile_id VARCHAR(15) NOT NULL',
    'message_id INT UNSIGNED NOT NULL',
    `${API_MAP.MessageMobileOriginated['MessageUTC']} TIMESTAMP DEFAULT NULL`,
    `${API_MAP.MessageMobileOriginated['ReceiveUTC']} TIMESTAMP DEFAULT NULL`,
    `${API_MAP.MessageMobileOriginated['SIN']} TINYINT UNSIGNED NOT NULL`,
    `${API_MAP.MessageMobileOriginated['MIN']} TINYINT UNSIGNED DEFAULT NULL`,
    // 'codec_is_forward BOOLEAN DEFAULT false',
    `size SMALLINT UNSIGNED DEFAULT NULL`,
    `${API_MAP.MessageMobileOriginated['RawPayload']} BLOB DEFAULT NULL`,
    `${API_MAP.MessageMobileOriginated['Payload']} JSON DEFAULT NULL`,
    `${API_MAP.MessageMobileOriginated['Name']} VARCHAR(50) DEFAULT NULL`,
  ],
  message_forward: [
    'id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY(id)',
    'category VARCHAR(25) DEFAULT "message_mobile_terminated"',
    'mobile_id VARCHAR(15) NOT NULL',
    'message_id INT UNSIGNED NOT NULL',
    `${API_MAP.MessageMobileTerminated['UserMessageID']} INT DEFAULT NULL`,
    `size SMALLINT UNSIGNED DEFAULT NULL`,
    'submit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
    'error_id SMALLINT UNSIGNED DEFAULT NULL',
    `${API_MAP.MessageMobileTerminated['State']} TINYINT UNSIGNED DEFAULT NULL`,
    'state_description VARCHAR(25) DEFAULT NULL',
    'state_time TIMESTAMP DEFAULT NULL',
    'closed BOOLEAN DEFAULT NULL',
    `${API_MAP.MessageMobileTerminated['ScheduledSendUTC']} TIMESTAMP DEFAULT NULL`,
    `${API_MAP.MessageMobileTerminated['ReferenceNumber']} INT DEFAULT NULL`,
    `${API_MAP.MessageMobileTerminated['RawPayload']} BLOB DEFAULT NULL`,
    `${API_MAP.MessageMobileTerminated['Payload']} JSON DEFAULT NULL`,
    `${API_MAP.MessageMobileTerminated['SIN']} TINYINT UNSIGNED NOT NULL`,
    `${API_MAP.MessageMobileTerminated['MIN']} TINYINT UNSIGNED DEFAULT NULL`,
    `${API_MAP.MessageMobileTerminated['Name']} VARCHAR(50) DEFAULT NULL`,
  ],
};

async function initialize() {
  let exists = await query(`SHOW DATABASES LIKE "${dbConfig.database}"`);
  if (exists.length === 0) {
    await query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
    console.log(`Created database ${dbConfig.database}`);
    await query(`USE ${dbConfig.database}`);
    for (let tableName in SCHEMA) {
      if (SCHEMA.hasOwnProperty(tableName)) {
        let tQuery = `CREATE TABLE IF NOT EXISTS ${tableName}(`;
        const table = SCHEMA[tableName];
        for (let column=0; column < table.length; column++) {
          if (column > 0) tQuery += ', ';
          tQuery += table[column];
        }
        tQuery += ')';
        await query(tQuery);
        console.log(`Created table ${tableName}`);
      }
    }
  } else {
    console.log(`Database ${dbConfig.database} exists`);
  }
}

///* COMMENT OUT FOR TEST ONLY
async function test() {
  await initialize();
  await end();
}
test();
// */

module.exports = {
  initialize,
  connect,
  query,
  end,
};
