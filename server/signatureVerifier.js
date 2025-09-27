const axios = require('axios');
const crypto = require('crypto');
const url = require('url');

const certCache = new Map();

function validateCertUrl(certUrl) {
  if (!certUrl) return false;
  const parsed = url.parse(certUrl);
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 's3.amazonaws.com' &&
    parsed.path &&
    parsed.path.startsWith('/echo.api/')
  );
}

async function loadCertificate(certUrl) {
  if (certCache.has(certUrl)) {
    const entry = certCache.get(certUrl);
    if (Date.now() - entry.timestamp < 6 * 60 * 60 * 1000) {
      return entry.pem;
    }
  }
  const response = await axios.get(certUrl);
  certCache.set(certUrl, { pem: response.data, timestamp: Date.now() });
  return response.data;
}

function buildStringToSign(reqBody, timestamp, nonce, endpoint) {
  const bodyDigest = crypto.createHash('sha256').update(reqBody, 'utf8').digest('base64');
  return `POST\n${bodyDigest}\n${timestamp}\n${nonce}\n${endpoint}`;
}

async function verifyAlexaRequest(req, res, next) {
  try {
    const signature = req.headers['signature'];
    const certUrl = req.headers['signaturecertchainurl'];
    const timestamp = req.headers['signature-timestamp'];
    const nonce = req.headers['signature-nonce'];

    if (!signature || !certUrl || !timestamp || !nonce) {
      return res.status(400).json({ error: 'Missing signature headers' });
    }

    if (!validateCertUrl(certUrl)) {
      return res.status(400).json({ error: 'Invalid certificate URL' });
    }

    const pem = await loadCertificate(certUrl);
    const publicKey = crypto.createPublicKey(pem);
    const endpoint = `https://${req.headers.host}${req.originalUrl}`;
    const body = req.rawBody || JSON.stringify(req.body);
    const stringToSign = buildStringToSign(body, timestamp, nonce, endpoint);

    const verifier = crypto.createVerify('sha256');
    verifier.update(stringToSign);
    const signatureBuffer = Buffer.from(signature, 'base64');
    const valid = verifier.verify(publicKey, signatureBuffer);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const requestTimestamp = new Date(timestamp);
    if (Math.abs(Date.now() - requestTimestamp.getTime()) > 150000) {
      return res.status(401).json({ error: 'Request timestamp too old' });
    }

    return next();
  } catch (err) {
    console.error('[codelexa] Signature verification failed', err);
    return res.status(401).json({ error: 'Signature verification failed' });
  }
}

module.exports = { verifyAlexaRequest };
