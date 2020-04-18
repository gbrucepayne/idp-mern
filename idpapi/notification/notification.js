const iotHub = require('../iothub/idp-iothub');
//TODO determine where to route notifications/alerts

module.exports = function(telemetry) {
  const mobileId = telemetry.mobileId;
  iotHub.sendTelemetry(mobileId, telemetry);
};