// Wyspa Build quote intake: receives quote requests and geometry files from
// build.wyspa.tech, saves them to Google Drive and emails the request.
// Deploy: Extensions > Apps Script (or script.google.com) > paste this file >
// Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone.
// Put the resulting /exec URL in pricing.js `uploadUrl`.

const FOLDER_NAME = 'Wyspa Build Quote Requests';
const NOTIFY = 'casey@wyspa.tech';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;
const OK_EXT = /\.(step|stp|iges|igs|stl|obj|3dm|dxf|dwg|pdf|sldprt|sldasm|x_t|x_b|f3d|png|jpe?g|zip)$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      subject: 'Quote request ' + qid,
      body: summary + '\n\nFiles (' + saved.length + '): ' + (saved.join(', ') || 'none') + '\nDrive folder: ' + folder.getUrl(),
    };
    if (email) mail.replyTo = email;
    MailApp.sendEmail(mail);

    return out({ ok: true, files: saved.length });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

function rootFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
