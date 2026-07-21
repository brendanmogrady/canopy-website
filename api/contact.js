const nodemailer = require('nodemailer');
const { getSalesforceToken, createRecord, resolveRecordTypeId } = require('./_sf');

// Where inquiry notifications are sent. Set CONTACT_NOTIFY_EMAIL in Vercel
// (it can differ per environment, e.g. Preview vs Production).
// The fallback is deliberately a personal inbox so a missing/misconfigured
// variable can never spam a shared mailbox.
const NOTIFY_EMAIL = process.env.CONTACT_NOTIFY_EMAIL || 'brendan.ogrady@cmcgfla.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, organization, title, email, phone, service, message } = req.body;

  if (!name || !organization || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const failures = [];
  const errors = []; // TEMP: detailed error messages for debugging

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
      to: NOTIFY_EMAIL,
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
    errors.push('email: ' + err.message);
  }

  // ── 2. Salesforce Website_Inquiry__c ─────────────────
  try {
    // Authenticate server-to-server via the Client Credentials flow
    const { accessToken, instanceUrl } = await getSalesforceToken();

    // Resolve the Contact_Us_Inquiry record type ID (differs sandbox vs prod)
    const recordTypeId = await resolveRecordTypeId(
      instanceUrl, accessToken, 'Website_Inquiry__c', 'Contact_Us_Inquiry'
    );

    // Create the Website_Inquiry__c record
    const inquiry = await createRecord(instanceUrl, accessToken, 'Website_Inquiry__c', {
      Name:                name,
      Organization__c:     organization,
      Title__c:            title || '',
      Email__c:            email,
      Phone__c:            phone || '',
      Area_of_Interest__c: service || '',
      Message__c:          message,
      Submitted_Date__c:   new Date().toISOString(),
      ...(recordTypeId && { RecordTypeId: recordTypeId }),
    });
    console.log('Salesforce Website_Inquiry__c created:', inquiry.id);
  } catch (err) {
    console.error('Salesforce error:', err.message);
    failures.push('salesforce');
    errors.push('salesforce: ' + err.message);
  }

  return res.status(200).json({ success: true, failures, errors });
};
