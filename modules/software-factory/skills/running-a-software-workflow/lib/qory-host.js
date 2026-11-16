// The route from a session to qory: plain HTTP/1.1 requests to QORY_HOST_URL, which forager
// sets in each session of a run with a route, as http://host.qory.invalid. That name never
// resolves: a request reaches the route only through the run's proxy in HTTP_PROXY, as an
// absolute URL, with the password of the proxy URL in Proxy-Authorization. A host under
// .invalid goes through HTTP_PROXY whatever NO_PROXY lists, because no such name resolves;
// another host that NO_PROXY lists, such as 127.0.0.1, is reached directly.
//
// The verbs are synchronous, so send starts this file with node and waits for it. As a
// script, it reads { target, proxy, method, path, body, until, pollMs } as JSON on stdin,
// sends the request, and while until is set, the answer is 200 with the state running, 429
// or 504, and the next try starts before until, waits and sends it again. It prints
// { status, type, body } or { error } as JSON on stdout, the one line it prints.
'use strict';

const childProcess = require('node:child_process');
const http = require('node:http');

const VARIABLE = 'QORY_HOST_URL';
// One request's timeout, above the 30 s after which forager's route returns 504 (qoryHostWait).
const REQUEST_MS = 35 * 1000;
// The most bytes read of a reply, above the 1 MiB cap of forager's route (MaxQoryHostBody).
const MAX_ANSWER = 2 * 1024 * 1024;
// The wait for this script after its last request; 35 s + 10 s fit in the 60 s Bash reserve.
const WAIT_MS = 10 * 1000;
// The pause before a retry after 429 or 504, as forager's 429 text says ("Retry in 1 second").
const RETRY_MS = 1000;

// target returns { base, host, port, problem }: base is the URL of QORY_HOST_URL in env
// without a slash at its end, and problem the line, fix first, of a value that is missing
// or no http:// URL, with the reason in more.
function target(env, verb) {
  const value = env[VARIABLE];
  if (!value) {
    return { problem: `Run ${verb} in a session of a qory run: ${VARIABLE} is not set here.`,
      more: [`forager sets ${VARIABLE} in each session of a run; the full suite starts only ` +
        'through it.'] };
  }
  let url = null;
  try {
    url = new URL(value);
  } catch {
    // The problem below.
  }
  if (!url || url.protocol !== 'http:' || url.username || url.password || url.search ||
    url.hash) {
    return { problem: `Report to a member: ${VARIABLE} is no http:// URL, such as ` +
      'http://host.qory.invalid.', more: [`Its value has ${value.length} characters.`] };
  }
  return { base: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 80) };
}

// bypass reports whether NO_PROXY in env lists host: by name, by a domain that ends it, or *.
function bypass(env, host) {
  const list = env.no_proxy ?? env.NO_PROXY ?? '';
  // An entry without its port: [::1]:80 is ::1, and example.com:80 is example.com.
  const name = (entry) => {
    const bracket = /^\[([^\]]*)\]/.exec(entry);
    if (bracket) return bracket[1];
    return entry.split(':').length === 2 ? entry.split(':')[0] : entry;
  };
  return list.split(',').map((one) => one.trim().toLowerCase()).filter(Boolean).some((one) => {
    const entry = name(one).replace(/^\*?\./, '');
    return one === '*' || host === entry || host.endsWith(`.${entry}`);
  });
}

// invalid reports whether host is under the top-level domain .invalid, under which no name
// resolves (RFC 2606), so that a request to it works only through the proxy.
const invalid = (host) => /(^|\.)invalid\.?$/.test(host.toLowerCase());

// proxyOf returns { host, port, auth } of the proxy that a request to host goes through,
// null for none, or { problem, more } for a proxy URL that is no http:// URL, or whose user
// or password has a bad percent escape: the agent cannot change HTTP_PROXY in a run.
function proxyOf(env, host) {
  const value = env.http_proxy || env.HTTP_PROXY;
  if (!value || (!invalid(host) && bypass(env, host.toLowerCase()))) return null;
  let url = null;
  try {
    url = new URL(value);
  } catch {
    // The problem below.
  }
  const problem = (cause) => ({ problem: 'Report to a member: HTTP_PROXY is no usable ' +
    'http:// proxy URL.', more: [cause] });
  if (!url || url.protocol !== 'http:') return problem('HTTP_PROXY is no URL with http://.');
  let auth = null;
  try {
    auth = url.username || url.password ? Buffer.from(`${decodeURIComponent(url.username)}:` +
      `${decodeURIComponent(url.password)}`).toString('base64') : null;
  } catch {
    return problem('The user or password of HTTP_PROXY has a bad percent escape.');
  }
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 80), auth };
}

// send sends one request of method to path below QORY_HOST_URL of io.env, with body as JSON
// when set, and returns { status, type, body } or { error }. With until, a time in
// milliseconds since the epoch, it sends a GET again every pollMs while the suite runs, and
// after a 429 or 504, as long as the next try starts before until. The caller has checked
// QORY_HOST_URL with target. When the script has not ended by then, send stops it with
// SIGKILL and returns { error: 'ETIMEDOUT' }; io.hostWaitMs replaces that wait only in a test.
function send(io, verb, { method, path, body, until, pollMs }) {
  const to = target(io.env, verb);
  const proxy = proxyOf(io.env, to.host);
  if (proxy && proxy.problem) return { error: 'proxy', ...proxy };
  // Without a proxy, a request to a host under .invalid fails at the name lookup.
  if (!proxy && invalid(to.host)) {
    return { error: 'proxy', problem: 'Report to a member: HTTP_PROXY is not set, and ' +
      'qory\'s route is reached only through it.', more: [`The host of ${VARIABLE}, ` +
      `${to.host}, is under .invalid, so no name lookup finds it.`] };
  }
  const wait = io.hostWaitMs !== undefined ? io.hostWaitMs
    : Math.ceil(Math.max((until || 0) - Date.now(), 0)) + REQUEST_MS + WAIT_MS;
  const ran = childProcess.spawnSync(process.execPath, [__filename], {
    input: JSON.stringify({ target: to, proxy, method, path, body, until, pollMs }),
    env: {}, encoding: 'utf8', timeout: wait, killSignal: 'SIGKILL',
    maxBuffer: 4 * MAX_ANSWER,
  });
  try {
    return JSON.parse(ran.stdout.trim().split('\n').pop());
  } catch {
    return { error: ran.error ? ran.error.code || 'stopped' : 'no answer' };
  }
}

// once sends one request and resolves to { status, type, body } or { error }.
function once({ target: to, proxy, method, path, body }) {
  const text = body === undefined ? null : JSON.stringify(body);
  // An IPv6 address goes in brackets, as in a URL.
  const name = to.host.includes(':') ? `[${to.host}]` : to.host;
  const headers = { Host: to.port === 80 ? name : `${name}:${to.port}`,
    Accept: 'application/json' };
  if (text !== null) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(text);
  }
  if (proxy && proxy.auth) headers['Proxy-Authorization'] = `Basic ${proxy.auth}`;
  return new Promise((resolve) => {
    const request = http.request({
      host: proxy ? proxy.host : to.host, port: proxy ? proxy.port : to.port, method,
      path: proxy ? `${to.base}${path}` : `${new URL(to.base).pathname.replace(/\/$/, '')}${path}`,
      headers, agent: false, timeout: REQUEST_MS,
    }, (response) => {
      const parts = [];
      let size = 0;
      response.on('data', (part) => {
        size += part.length;
        if (size > MAX_ANSWER) {
          request.destroy();
          resolve({ error: 'too large' });
          return;
        }
        parts.push(part);
      });
      response.on('end', () => resolve({ status: response.statusCode,
        type: response.headers['content-type'] || '',
        body: Buffer.concat(parts).toString('utf8') }));
      response.on('error', (error) => resolve({ error: error.code || 'broken' }));
    });
    request.on('timeout', () => {
      request.destroy();
      resolve({ error: 'ETIMEDOUT' });
    });
    request.on('error', (error) => resolve({ error: error.code || 'broken' }));
    request.end(text === null ? undefined : text);
  });
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// running reports whether answer is a 200 whose JSON has the state running.
function running(answer) {
  if (answer.status !== 200) return false;
  try {
    return JSON.parse(answer.body).state === 'running';
  } catch {
    return false;
  }
}

async function script(input) {
  const { until, pollMs } = input;
  for (;;) {
    const answer = await once(input);
    const retry = answer.status === 429 || answer.status === 504;
    if (!until || !(running(answer) || retry)) return answer;
    const pause = retry ? RETRY_MS : pollMs;
    if (Date.now() + pause >= until) return answer;
    await sleep(pause);
  }
}

if (require.main === module) {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (part) => { text += part; });
  process.stdin.on('end', () => {
    script(JSON.parse(text)).then((answer) => {
      process.stdout.write(`${JSON.stringify(answer)}\n`);
    });
  });
}

module.exports = { VARIABLE, MAX_ANSWER, target, proxyOf, bypass, send };
