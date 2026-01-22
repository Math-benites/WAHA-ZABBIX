import http from 'http';
import { URL } from 'url';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

const PORT = process.env.PORT || 3000;
const WAHA_URL = process.env.WAHA_URL || 'http://waha:3000/api/sendText';
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';
const API_KEY = process.env.API_KEY; // optional shared secret for this webhook
const WAHA_API_KEY_FALLBACK = process.env.WAHA_API_KEY_FALLBACK || process.env.WAHA_API_KEY;
const DEBUG_LOG = process.env.DEBUG_LOG || 'debuglog.log';
const debugLogPath = path.resolve(DEBUG_LOG);

function logDebug(event, data) {
  const line = `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`;
  fs.promises.appendFile(debugLogPath, line).catch(err => {
    console.error('debug log write failed', err);
  });
}

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data);
}

async function handleSend(req, res, query, bodyStr) {
  console.log('incoming headers', req.headers);
  if (bodyStr) {
    console.log('incoming body', bodyStr);
  } else {
    console.log('incoming body is empty');
  }
  logDebug('incoming', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    query: Object.fromEntries(query.entries()),
    body: bodyStr
  });
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  let formParams = null;
  if (bodyStr && contentType.includes('application/x-www-form-urlencoded')) {
    try { formParams = new URLSearchParams(bodyStr); } catch (_) { /* ignore */ }
  }
  let bodyObj = null;
  if (bodyStr) {
    try { bodyObj = JSON.parse(bodyStr); } catch (_) { /* ignore JSON parse errors */ }
  }

  const clientApiKey =
    req.headers['x-api-key'] ||
    query.get('api_key') ||
    (formParams && formParams.get('api_key')) ||
    (bodyObj && bodyObj.api_key);
  // fallback: se vier raw JSON como string em form-urlencoded, tentar extrair api_key
  if (!clientApiKey && formParams && bodyStr && bodyStr.trim().startsWith('{')) {
    try {
      const parsedRaw = JSON.parse(bodyStr);
      if (parsedRaw.api_key) clientApiKey = parsedRaw.api_key;
    } catch (_) { /* ignore */ }
  }

  if (API_KEY) {
    if (!clientApiKey || clientApiKey !== API_KEY) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
  }

  let to = (query.get('to') || '').toString();
  let text = (query.get('text') || '').toString();
  let isGroup = false;

  if (!to && bodyObj?.to) {
    to = String(bodyObj.to);
  }
  if (!to && formParams?.get('to')) {
    to = String(formParams.get('to'));
  }
  if (!text && bodyObj?.text) {
    text = String(bodyObj.text);
  }
  if (!text && formParams?.get('text')) {
    text = String(formParams.get('text'));
  }
  if (bodyObj && bodyObj.group !== undefined) {
    isGroup = Boolean(bodyObj.group);
  }
  if (formParams && formParams.get('group') !== null) {
    const raw = formParams.get('group');
    const val = typeof raw === 'string' ? raw.toLowerCase() : raw;
    isGroup = val === true || val === 'true' || val === '1' || val === 'yes' || val === 'on';
  }

  if (query.has('group')) {
    const raw = query.get('group');
    const val = typeof raw === 'string' ? raw.toLowerCase() : raw;
    isGroup = val === true || val === 'true' || val === '1' || val === 'yes' || val === 'on';
  }

  if (!to || !text) {
    return sendJson(res, 400, { error: 'missing to or text' });
  }

  const phone = String(to).replace(/\D/g, '');
  if (!phone) {
    return sendJson(res, 400, { error: 'invalid phone' });
  }
  const suffix = isGroup ? '@g.us' : '@c.us';
  const chatId = `${phone}${suffix}`;
  const urlWithSession =
    WAHA_URL.includes('session=') ?
      WAHA_URL :
      `${WAHA_URL}${WAHA_URL.includes('?') ? '&' : '?'}session=${encodeURIComponent(WAHA_SESSION)}`;

  const payload = {
    session: WAHA_SESSION,
    chatId,
    text
  };
  const wahaApiKeyFromReq =
    req.headers['x-waha-api-key'] ||
    query.get('waha_api_key') ||
    (formParams && formParams.get('waha_api_key')) ||
    (bodyObj && (bodyObj.waha_api_key || bodyObj.wahaApiKey)) ||
    (!API_KEY ? clientApiKey : undefined) ||
    WAHA_API_KEY_FALLBACK; // fallback final: usa env
  const forwardHeaders = { 'Content-Type': 'application/json' };
  if (wahaApiKeyFromReq) {
    forwardHeaders['X-Api-Key'] = wahaApiKeyFromReq;
  }
  console.log('forwarding to WAHA', { url: urlWithSession, hasApiKey: Boolean(wahaApiKeyFromReq) });
  logDebug('forwarding', {
    url: urlWithSession,
    headers: forwardHeaders,
    payload
  });

  try {
    const forwarded = await axios.post(urlWithSession, payload, {
      headers: forwardHeaders
    });
    return sendJson(res, 200, { forwardedStatus: forwarded.status, forwardedData: forwarded.data });
  } catch (err) {
    const status = err.response?.status || 500;
    const data = err.response?.data || { error: err.message };
    return sendJson(res, status, { error: 'forward_failed', detail: data });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  console.log(`${req.method} ${url.pathname}${url.search || ''}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { status: 'ok' });
  }

  if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/send') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString('utf8'); });
    req.on('end', () => {
      handleSend(req, res, url.searchParams, body);
    });
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`api_message_zabbix listening on port ${PORT}`);
  console.log(`Forwarding to WAHA at ${WAHA_URL} session=${WAHA_SESSION}`);
});
