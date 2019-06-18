
const https = require('http');

const fetchKeysOfType = (t, d) => Object.keys(d).filter(k => d[k].class === t);

const listTenants = d => fetchKeysOfType('Tenant', d);
const listApplications = d => fetchKeysOfType('Application', d);

// provided for reference, why not just use d[k] directly?
// eslint-disable-next-line no-unused-vars
const getTenant = (d, k) => d[k];

// as3 request object, intended to stream/lock later
function ATRequest(device) {
  this.device = device;
  return this;
}

const makeRequest = (opts, body) => new Promise((resolve, reject) => {
  const req = https.request(opts, (res) => {
    const buffer = [];
    res.setEncoding('utf8');
    res.on('data', (data) => {
      buffer.push(data);
    });
    res.on('end', () => {
      const raw_body = buffer.join('');

      const json_body = (() => {
        if (res.statusCode === 204) return '';
        try {
          return JSON.parse(raw_body);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(raw_body);
          // eslint-disable-next-line no-console
          console.error(e);
          return reject(new Error(`Invalid Response object from ${opts.path}`));
        }
      })();

      resolve({
        opts,
        status: res.statusCode,
        headers: res.headers,
        body: json_body,
      });
    });
  });

  req.on('error', (e) => {
    // eslint-disable-next-line no-console
    console.error(`ERROR: Could not connect to ${opts.host} on port ${opts.port}`);
    // eslint-disable-next-line no-console
    console.error(e);
    reject(new Error(`${opts.host}:${e.message}`));
  });

  if (body) req.write(JSON.stringify(body));

  req.end();
});

ATRequest.prototype.as3_info = function () {
  const device = this.device;

  const opts = {
    host: device.ipaddress,
    port: device.port,
    auth: `${device.username}:${device.password}`,
    rejectUnauthorized: false,
    path: '/mgmt/shared/appsvcs/info',
  };
  return makeRequest(opts);
};

ATRequest.prototype.ts_info = function () {
  const device = this.device;

  const opts = {
    host: device.ipaddress,
    port: device.port,
    auth: `${device.username}:${device.password}`,
    rejectUnauthorized: false,
    path: '/mgmt/shared/telemetry/info',
  };
  return makeRequest(opts);
};

ATRequest.prototype.declaration = function (tenant) {
  const device = this.device;
  const t = tenant ? `/${tenant}` : '';

  const opts = {
    host: device.ipaddress,
    port: device.port,
    auth: `${device.username}:${device.password}`,
    rejectUnauthorized: false,
    path: `/mgmt/shared/appsvcs/declare${t}`,
  };

  return makeRequest(opts);
};

ATRequest.prototype.declare = function (adc) {
  const device = this.device;
  const opts = {
    host: device.ipaddress,
    port: device.port,
    auth: `${device.username}:${device.password}`,
    rejectUnauthorized: false,
    path: '/mgmt/shared/appsvcs/declare?showHash=true',
    method: 'POST',
  };

  return makeRequest(opts, adc);
};

module.exports = {
  listTenants,
  listApplications,
  ATRequest,
};
