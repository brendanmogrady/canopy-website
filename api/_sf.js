// ─────────────────────────────────────────────────────────────
// Shared Salesforce helpers — OAuth 2.0 Client Credentials flow
// Used by api/contact.js and api/careers.js.
//
// Required environment variables (set in Vercel):
//   SF_LOGIN_URL     e.g. https://canopy...--partial1.sandbox.my.salesforce.com
//   SF_CLIENT_ID     External Client App consumer key
//   SF_CLIENT_SECRET External Client App consumer secret
// ─────────────────────────────────────────────────────────────

const API_VERSION = 'v60.0';

// Authenticate server-to-server. Returns { accessToken, instanceUrl }.
async function getSalesforceToken() {
  const res = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SF_CLIENT_ID,
      client_secret: process.env.SF_CLIENT_SECRET,
    }),
  });

  const token = await res.json();
  if (!res.ok || !token.access_token) {
    throw new Error(`SF auth failed: ${JSON.stringify(token)}`);
  }
  return { accessToken: token.access_token, instanceUrl: token.instance_url };
}

function sfHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

// Create an sObject record. Returns the API response ({ id, success, ... }).
async function createRecord(instanceUrl, accessToken, sobject, fields) {
  const res = await fetch(
    `${instanceUrl}/services/data/${API_VERSION}/sobjects/${sobject}/`,
    { method: 'POST', headers: sfHeaders(accessToken), body: JSON.stringify(fields) }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Create ${sobject} failed: ${JSON.stringify(data)}`);
  return data;
}

// Resolve a RecordType Id by DeveloperName (sandbox/prod differ — never hardcode).
async function resolveRecordTypeId(instanceUrl, accessToken, sobject, developerName) {
  const q = encodeURIComponent(
    `SELECT Id FROM RecordType WHERE SObjectType='${sobject}' AND DeveloperName='${developerName}' LIMIT 1`
  );
  const res = await fetch(
    `${instanceUrl}/services/data/${API_VERSION}/query?q=${q}`,
    { headers: sfHeaders(accessToken) }
  );
  const data = await res.json();
  return data.records?.[0]?.Id || null;
}

// Upload a file as a ContentVersion and auto-link it to a record via
// FirstPublishLocationId (no second ContentDocumentLink call needed).
async function uploadFile(instanceUrl, accessToken, { title, filename, base64, parentId }) {
  const res = await fetch(
    `${instanceUrl}/services/data/${API_VERSION}/sobjects/ContentVersion/`,
    {
      method: 'POST',
      headers: sfHeaders(accessToken),
      body: JSON.stringify({
        Title: title,
        PathOnClient: filename,
        VersionData: base64,
        FirstPublishLocationId: parentId,
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`ContentVersion upload failed: ${JSON.stringify(data)}`);
  return data;
}

module.exports = {
  API_VERSION,
  getSalesforceToken,
  createRecord,
  resolveRecordTypeId,
  uploadFile,
};
