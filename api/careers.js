const nodemailer = require('nodemailer');
const { getSalesforceToken, createRecord, uploadFile } = require('./_sf');

// Position (from the job card clicked) → Department. Server is the source of
// truth so we don't trust a client-supplied department.
const POSITION_TO_DEPARTMENT = {
  'Project Manager': 'Project Management',
  'Project Coordinator': 'Project Management',
  'Business Analyst Consultant': 'Business Analysis',
  'Entry-Level Salesforce Data Specialist': 'Salesforce',
  'Marketing & Procurement Specialist': 'Marketing & Procurement',
  // 'General / Other' → no department
};

// Where application notifications are sent. Set CAREERS_NOTIFY_EMAIL in Vercel
// (it can differ per environment, e.g. Preview vs Production).
// GO-LIVE: set CAREERS_NOTIFY_EMAIL='careers@cmcgfla.com' in Production.
// The fallback is deliberately a personal inbox so a missing/misconfigured
// variable can never spam the shared careers mailbox.
const NOTIFY_EMAIL = process.env.CAREERS_NOTIFY_EMAIL || 'brendan.ogrady@cmcgfla.com';

const ALLOWED_RESUME_EXT = ['pdf', 'doc', 'docx'];
const MAX_RESUME_BYTES = 3 * 1024 * 1024; // ~3 MB raw (stays under Vercel's body limit once base64-encoded)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    name,
    email,
    phone,
    linkedin,
    workAuthorization,
    referralSource,
    referralSourceDetail,
    earliestStartDate,
    salaryExpectation,
    experienceLevel,
    message,
    position,
    // résumé: base64 (no data-URL prefix) + original filename
    resumeBase64,
    resumeFilename,
  } = req.body || {};

  // ── Validation ────────────────────────────────────────
  if (!name || !email || !workAuthorization) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (resumeBase64) {
    const ext = (resumeFilename || '').split('.').pop().toLowerCase();
    if (!ALLOWED_RESUME_EXT.includes(ext)) {
      return res.status(400).json({ error: 'Résumé must be a PDF, DOC, or DOCX file' });
    }
    // base64 length → byte size: every 4 chars ≈ 3 bytes
    const approxBytes = Math.floor((resumeBase64.length * 3) / 4);
    if (approxBytes > MAX_RESUME_BYTES) {
      return res.status(400).json({ error: 'Résumé is too large (max 3 MB)' });
    }
  }

  const positionLabel = position || 'General / Other';
  const department = POSITION_TO_DEPARTMENT[positionLabel] || '';
  const failures = [];
  const errors = []; // TEMP: detailed error messages for debugging

  // ── 1. Email notification ─────────────────────────────
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: `"Canopy Careers" <${process.env.SMTP_USER}>`,
      to: NOTIFY_EMAIL,
      replyTo: email,
      subject: `New Application: ${name} — ${positionLabel}`,
      text: [
        `Position: ${positionLabel}`,
        `Department: ${department || '—'}`,
        `Name: ${name}`,
        `Email: ${email}`,
        `Phone: ${phone || '—'}`,
        `LinkedIn: ${linkedin || '—'}`,
        `Work Authorization: ${workAuthorization}`,
        `Experience Level: ${experienceLevel || '—'}`,
        `Earliest Start Date: ${earliestStartDate || '—'}`,
        `Salary Expectation: ${salaryExpectation || '—'}`,
        `How did you hear about us: ${referralSource || '—'}${referralSourceDetail ? ` (${referralSourceDetail})` : ''}`,
        `Résumé attached in Salesforce: ${resumeFilename || '—'}`,
        '',
        'Note:',
        message || '—',
      ].join('\n'),
    });
  } catch (err) {
    console.error('Email error:', err.message);
    failures.push('email');
    errors.push('email: ' + err.message);
  }

  // ── 2. Salesforce Career_Application__c + résumé file ─
  try {
    const { accessToken, instanceUrl } = await getSalesforceToken();

    // Build payload — omit empty optional fields (empty strings break Date/picklist).
    const fields = {
      Name: name,
      Email__c: email,
      Work_Authorization__c: workAuthorization,
      Position__c: positionLabel,
      Submitted_Date__c: new Date().toISOString(),
    };
    if (phone) fields.Phone__c = phone;
    if (linkedin) fields.LinkedIn_URL__c = linkedin;
    if (referralSource) fields.Referral_Source__c = referralSource;
    if (referralSourceDetail) fields.Referral_Source_Detail__c = referralSourceDetail;
    if (earliestStartDate) fields.Earliest_Start_Date__c = earliestStartDate;
    if (salaryExpectation) fields.Salary_Expectation__c = salaryExpectation;
    if (experienceLevel) fields.Experience_Level__c = experienceLevel;
    if (message) fields.Message__c = message;
    if (department) fields.Department__c = department;
    // Status__c and Source__c are left to their Salesforce defaults.

    const record = await createRecord(instanceUrl, accessToken, 'Career_Application__c', fields);
    console.log('Salesforce Career_Application__c created:', record.id);

    // Attach résumé as a Salesforce File linked to the new record.
    if (resumeBase64 && record.id) {
      try {
        await uploadFile(instanceUrl, accessToken, {
          title: resumeFilename || `${name} Résumé`,
          filename: resumeFilename || 'resume.pdf',
          base64: resumeBase64,
          parentId: record.id,
        });
        console.log('Résumé uploaded for', record.id);
      } catch (fileErr) {
        console.error('Résumé upload error:', fileErr.message);
        failures.push('resume');
        errors.push('resume: ' + fileErr.message);
      }
    }
  } catch (err) {
    console.error('Salesforce error:', err.message);
    failures.push('salesforce');
    errors.push('salesforce: ' + err.message);
  }

  return res.status(200).json({ success: true, failures, errors });
};
