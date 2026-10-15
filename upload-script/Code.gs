// Wyspa Build quote intake: receives quote requests and geometry files from
// build.wyspa.tech, saves them to Google Drive and emails the request.
// Owned by ai@wyspa.tech; files land in Drive: Wyspa Tech/Share/AI/6 - Build quote requests.
// Deployed as a web app (executeAs: owner, access: anyone; see appsscript.json).
// Put the resulting /exec URL in pricing.js `uploadUrl`.
//
// Card checkout ("Order and pay by card", pricing.js checkoutEnabled): with d.checkout the request is saved and
// emailed as usual, then a Square payment link is made for d.amount (cents) and returned as checkoutUrl.
// Script properties (Project settings > Script properties): SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID. Never put the token in code.
// The browser sends the amount, so it can be tampered with. That's accepted: before any work starts we check
// paid amount = checked price (ops/payment-setup.md).

const FOLDER_ID = '1qPenfnMvJIZVivt4dVR-LO9EIJpQXXKy';  // Share/AI/6 - Build quote requests
const NOTIFY = 'casey@wyspa.tech';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
// Keep in step with SEND_OK in index.html: the page refuses any other type so nothing is dropped silently.
const OK_EXT = /\.(step|stp|iges|igs|stl|obj|3dm|dxf|dwg|pdf|sldprt|sldasm|x_t|x_b|f3d|png|jpe?g|zip)$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAY_MIN = 150000, PAY_MAX = 5000000;  // cents: $1,500 minimum order to $50,000
const SQUARE_LINKS = 'https://connect.squareup.com/v2/online-checkout/payment-links';

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.website) return out({ ok: true, files: 0 });  // honeypot: bots fill hidden field

    // Simple global rate limit: 40 requests per 10 minutes
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get('n') || 0);
    if (n >= 40) return out({ ok: false, error: 'busy, try again later' });
    cache.put('n', String(n + 1), 600);

    const qid = String(d.qid || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 24) || 'WB-unknown';
    const email = EMAIL.test(d.email || '') ? String(d.email).slice(0, 120) : '';
    const summary = String(d.summary || '').slice(0, 20000);
    const files = (Array.isArray(d.files) ? d.files : []).slice(0, MAX_FILES);
    // Card checkout: refuse a bad amount before saving anything; the page tells them to use Send.
    const pay = d.checkout === true;
    const amount = Number(d.amount);
    if (pay && !(Number.isInteger(amount) && amount >= PAY_MIN && amount <= PAY_MAX))
      return out({ ok: false, useSend: true, error: "We can't take a card payment for this order online. Please use Send instead and we'll email you a quote." });
    const dollars = pay ? '$' + (amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';

    const folder = rootFolder_().createFolder(qid + (email ? ' ' + email : ''));
    folder.createFile(qid + ' request.txt', summary, MimeType.PLAIN_TEXT);

    let total = 0;
    const saved = [];
    files.forEach(f => {
      const name = String(f.name || 'file').slice(0, 150);
      if (!OK_EXT.test(name)) return;
      const bytes = Utilities.base64Decode(String(f.data || ''));
      total += bytes.length;
      if (total > MAX_BYTES) throw new Error('files over 25 MB');
      folder.createFile(Utilities.newBlob(bytes, f.type || 'application/octet-stream', name));
      saved.push(name);
    });

    const mail = {
      to: NOTIFY,
      subject: pay ? 'PAID CHECKOUT STARTED ' + qid : 'Quote request ' + qid,
      body: (pay ? 'Card checkout started: ' + dollars + ' (amount sent by the page; check it equals the checked price before starting).\n\n' : '') + summary +'\n\nFiles (' + saved.length + '): ' + (saved.join(', ') || 'none') + '\nDrive folder: ' + folder.getUrl(),
    };
    if (email) mail.replyTo = email;
    MailApp.sendEmail(mail);

    if (!pay) return out({ ok: true, files: saved.length });
    // The request is saved and emailed already, so a Square failure never loses it: the page says we'll email a pay link.
    try {
      return out({ ok: true, files: saved.length, checkoutUrl: squareLink_(qid, amount, email) });
    } catch (err) {
      try { MailApp.sendEmail({ to: NOTIFY, subject: 'Pay link FAILED ' + qid, body: 'Square link for ' + dollars + ' failed: ' + String(err && err.message || err) + '\nSend the customer a pay link by hand.' }); } catch (e2) {}
      return out({ ok: true, files: saved.length, message: "Request sent. We'll email you a pay link." });
    }
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

// Square payment link for one order. Throws if there's no token or Square refuses.
function squareLink_(qid, amount, email) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('SQUARE_ACCESS_TOKEN'), location = props.getProperty('SQUARE_LOCATION_ID');
  if (!token || !location) throw new Error('no SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID in script properties');
  const body = {
    idempotency_key: qid + '-' + amount,  // same order and amount = same link; a changed amount gets a new one
    quick_pay: { name: 'Wyspa Build ' + qid, price_money: { amount: amount, currency: 'USD' }, location_id: location },
    payment_note: qid,
    checkout_options: { redirect_url: 'https://build.wyspa.tech/?paid=' + qid, ask_for_shipping_address: true },
  };
  if (email) body.pre_populated_data = { buyer_email: email };
  const r = UrlFetchApp.fetch(SQUARE_LINKS, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token, 'Square-Version': '2024-10-17' },
    payload: JSON.stringify(body),
  });
  const j = JSON.parse(r.getContentText() || '{}');
  const url = j.payment_link && j.payment_link.url;
  if (r.getResponseCode() !== 200 || !url) throw new Error('Square ' + r.getResponseCode() + ': ' + JSON.stringify(j.errors || j).slice(0, 500));
  return url;
}

function rootFolder_() {
  return DriveApp.getFolderById(FOLDER_ID);
}

// Visiting the /exec URL while signed in as the owner grants Drive and Gmail access once.
function doGet() {
  rootFolder_();
  return out({ ok: true, service: 'Wyspa Build quote intake' });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
