const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, organization, title, email, phone, service, message } = req.body;

  if (!name || !organization || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const failures = [];

  // ── 1. Email notification ─────────────────────────────
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Canopy Website" <${process.env.SMTP_USER}>`,
      to: 'brendan.ogrady@cmcgfla.com',
      replyTo: email,
      subject: `New Inquiry: ${name} — ${organization}`,
      text: [
        `Name: ${name}`,
        `Organization: ${organization}`,
        `Title: ${title || '—'}`,
        `Email: ${email}`,
        `Phone: ${phone || '—'}`,
        `Area of Interest: ${service || '—'}`,
        '',
        'Message:',
        message,
      ].join('\n'),
      html: `
        <h2 style="font-family:sans-serif;">New Website Inquiry</h2>
        <table style="font-family:sans-serif;border-collapse:collapse;">
          <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Name</td><td>${name}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Organization</td><td>${organization}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Title</td><td>${title || '—'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Email</td><td><a href="mailto:${email}">${email}</a></td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Phone</td><td>${phone || '—'}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Area of Interest</td><td>${service || '—'}</td></tr>
        </table>
        <h3 style="font-family:sans-serif;margin-top:1.5rem;">Message</h3>
        <p style="font-family:sans-serif;white-space:pre-wrap;">${message}</p>
      `,
    });
  } catch (err) {
    console.error('Email error:', err.message);
    failures.push('email');
  }

  // ── 2. Salesforce Website_Inquiry__c ─────────────────
  try {
    // Authenticate via username-password OAuth flow
    const tokenRes = await fetch(`${process.env.SF_LOGIN_URL}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: process.env.SF_CLIENT_ID,
        client_secret: process.env.SF_CLIENT_SECRET,
        username: process.env.SF_USERNAME,
        password: process.env.SF_PASSWORD + (process.env.SF_SECURITY_TOKEN || ''),
      }),
    });

    const token = await tokenRes.json();
    if (!token.access_token) throw new Error(`SF auth failed: ${JSON.stringify(token)}`);

    const apiBase = `${token.instance_url}/services/data/v60.0`;
    const headers = {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    };

    // Resolve the Contact_Us_Inquiry record type ID
    const rtQuery = encodeURIComponent(
      "SELECT Id FROM RecordType WHERE SObjectType='Website_Inquiry__c' AND DeveloperName='Contact_Us_Inquiry' LIMIT 1"
    );
    const rtRes  = await fetch(`${apiBase}/query?q=${rtQuery}`, { headers });
    const rtData = await rtRes.json();
    const recordTypeId = rtData.records?.[0]?.Id;

    // Create the Website_Inquiry__c record
    const inquiryRes = await fetch(`${apiBase}/sobjects/Website_Inquiry__c/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        Name:                name,
        Organization__c:     organization,
        Title__c:            title || '',
        Email__c:            email,
        Phone__c:            phone || '',
        Area_of_Interest__c: service || '',
        Message__c:          message,
        Status__c:           'New',
        Submitted_Date__c:   new Date().toISOString(),
        ...(recordTypeId && { RecordTypeId: recordTypeId }),
      }),
    });

    const inquiry = await inquiryRes.json();
    if (!inquiryRes.ok) throw new Error(JSON.stringify(inquiry));
    console.log('Salesforce Website_Inquiry__c created:', inquiry.id);
  } catch (err) {
    console.error('Salesforce error:', err.message);
    failures.push('salesforce');
  }

  return res.status(200).json({ success: true, failures });
};
