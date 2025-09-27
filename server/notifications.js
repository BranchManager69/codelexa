const https = require('https');
const querystring = require('querystring');

function getSkillCredentials() {
  const clientId = process.env.ALEXA_CLIENT_ID;
  const clientSecret = process.env.ALEXA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('ALEXA_CLIENT_ID and ALEXA_CLIENT_SECRET must be set');
  }
  return { clientId, clientSecret };
}

function fetchAccessToken() {
  const { clientId, clientSecret } = getSkillCredentials();
  const postData = querystring.stringify({
    grant_type: 'client_credentials',
    scope: 'alexa::devices:all:notifications:write',
    client_id: clientId,
    client_secret: clientSecret
  });

  const options = {
    host: 'api.amazon.com',
    path: '/auth/o2/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            resolve(parsed.access_token);
          } else {
            reject(new Error(`No access_token in response: ${data}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function sendNotification(accessToken, skillId, content) {
  const body = JSON.stringify({
    timestamp: new Date().toISOString(),
    referenceId: `codex-${Date.now()}`,
    expiryTime: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    event: {
      name: 'AMAZON.MessageAlert.Activated',
      payload: {
        state: {
          status: 'UNREAD',
          freshness: 'NEW'
        },
        messageGroup: {
          creator: {
            name: 'Codex'
          },
          count: 1
        }
      }
    },
    localizedAttributes: [
      {
        locale: 'en-US',
        message: content || 'Codex finished a task.'
      }
    ],
    relevantAudience: {
      type: 'Multicast'
    }
  });

  const options = {
    host: 'api.amazonalexa.com',
    path: `/v1/skillMessaging`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': `Bearer ${accessToken}`
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Notification failed: ${res.statusCode} ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function notify(content) {
  const skillId = process.env.ALEXA_SKILL_ID;
  if (!skillId) {
    throw new Error('ALEXA_SKILL_ID must be set');
  }
  const accessToken = await fetchAccessToken();
  await sendNotification(accessToken, skillId, content);
}

module.exports = {
  notify
};
