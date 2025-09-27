const notifications = require('./notifications');

async function sendCompletionNotice(summary) {
  try {
    await notifications.notify(summary);
  } catch (err) {
    console.error('[codelexa] Failed to send Alexa notification', err);
  }
}

module.exports = { sendCompletionNotice };
