function doGet(e) {
  if (e && e.parameter && e.parameter.api === '1') {
    return handleApiRequest(e.parameter.action, e.parameter);
  }
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Agenda Mengajar Guru')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    return handleApiRequest(body.action, body);
  } catch (error) {
    return jsonResponse({ success: false, message: 'Format permintaan tidak valid: ' + error.message });
  }
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleApiRequest(action, data) {
  try {
    switch (String(action || '').trim()) {
      case 'loginUser':
        return jsonResponse(loginUser(data.email, data.password));
      case 'getTeacherSchedule':
        return jsonResponse(getTeacherSchedule(data.email, data.dayName, data.dateStr));
      case 'saveAgenda':
        return jsonResponse(saveAgenda(data.payload || data));
      case 'getAgendaHistory':
        return jsonResponse(getAgendaHistory(data.email, data.filterDate, data.filterClass, data.searchQuery));
      case 'deleteAgenda':
        return jsonResponse(deleteAgenda(data.email, data.agendaId));
      case 'exportAgendaPdf':
        return jsonResponse(exportAgendaPdf(data.email, data.filterDate, data.filterClass, data.searchQuery, data.teacherName, data.subject));
      default:
        return jsonResponse({ success: false, message: 'Aksi API tidak dikenal.' });
    }
  } catch (error) {
    return jsonResponse({ success: false, message: 'Kesalahan API: ' + error.message });
  }
}

function getDb() {
  var defaultSpreadsheetId = '1dUgfqOXAmb5Y2fbtSYwuln83jV3WuXnKhYatpGC4yyA';
  const spreadsheetId = PropertiesService
    .getScriptProperties()
    .getProperty('SPREADSHEET_ID') || defaultSpreadsheetId;

  return SpreadsheetApp.openById(spreadsheetId);
}

function authorizeApp() {
  getDb();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  return 'Otorisasi aplikasi selesai.';
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function table(sheetName) {
  const sheet = getDb().getSheetByName(sheetName);
  if (!sheet) return null;
  const values = sheet.getDataRange().getValues();
  const headers = {};
  if (values.length) values[0].forEach((value, index) => headers[normalize(value)] = index);
  return { sheet, values, headers };
}

function getCell(row, index) {
  return index === undefined ? '' : row[index];
}

function loginUser(email, password) {
  try {
    const data = table('USERS');
    if (!data) return { success: false, message: 'Sheet USERS tidak ditemukan.' };
    if (data.values.length <= 1) return { success: false, message: 'Data pengguna masih kosong.' };
    if (data.headers.email === undefined || data.headers.password === undefined) {
      return { success: false, message: 'Kolom email atau password tidak ditemukan.' };
    }

    for (let i = 1; i < data.values.length; i++) {
      const row = data.values[i];
      if (normalize(row[data.headers.email]) === normalize(email) && String(row[data.headers.password] || '').trim() === String(password || '').trim()) {
        return {
          success: true,
          user: {
            email: row[data.headers.email],
            namaGuru: getCell(row, data.headers['nama guru']) || 'Guru',
            mapel: getCell(row, data.headers.mapel) || '-',
            kelas: getCell(row, data.headers.kelas) || '-'
          }
        };
      }
    }
    return { success: false, message: 'Email atau password salah.' };
  } catch (error) {
    return { success: false, message: 'Terjadi kesalahan sistem: ' + error.message };
  }
}

function getTeacherSchedule(email, dayName, dateStr) {
  try {
    const users = table('USERS');
    const schedule = table('JADWAL');
    if (!users) return { success: false, message: 'Sheet USERS tidak ditemukan.' };
    if (!schedule) return { success: false, message: 'Sheet JADWAL tidak ditemukan.' };

    const emailIndex = users.headers.email;
    const nameIndex = users.headers['nama guru'];
    const subjectIndex = users.headers.mapel;
    let teacherName = '';
    let subject = '-';

    for (let i = 1; i < users.values.length; i++) {
      const row = users.values[i];
      if (normalize(row[emailIndex]) === normalize(email)) {
        teacherName = String(getCell(row, nameIndex) || '').trim();
        subject = String(getCell(row, subjectIndex) || '-').trim();
        break;
      }
    }

    if (!teacherName) return { success: false, message: 'Nama guru tidak ditemukan.' };

    const agendaMap = getAgendaMap(email, dateStr);
    const slots = [];
    const classHeaders = schedule.values[0] || [];

    for (let rowIndex = 1; rowIndex < schedule.values.length; rowIndex++) {
      const row = schedule.values[rowIndex];
      const jam = String(row[0] || 'Jam ke-' + rowIndex).trim();
      for (let columnIndex = 1; columnIndex < row.length; columnIndex++) {
        if (String(row[columnIndex] || '').toLowerCase().includes(teacherName.toLowerCase())) {
          slots.push({ jam, kelas: String(classHeaders[columnIndex] || '').trim(), mapel: subject, rowIndex });
        }
      }
    }

    return { success: true, teacherName, mapel: subject, schedule: mergeSlots(slots, agendaMap) };
  } catch (error) {
    return { success: false, message: 'Gagal mengambil jadwal: ' + error.message };
  }
}

function getAgendaMap(email, dateStr) {
  const data = table('AGENDA');
  const result = {};
  if (!data || data.values.length <= 1) return result;

  for (let i = 1; i < data.values.length; i++) {
    const row = data.values[i];
    if (normalize(getCell(row, data.headers.email)) !== normalize(email)) continue;
    if (formatDate(getCell(row, data.headers.tanggal)) !== dateStr) continue;
    const key = String(getCell(row, data.headers.kelas) || '').trim() + '|' + String(getCell(row, data.headers.jam) || '').trim();
    result[key] = { id: getCell(row, data.headers.id), status: getCell(row, data.headers.status) || 'Draft' };
  }
  return result;
}

function mergeSlots(slots, agendaMap) {
  const merged = [];
  let current = null;

  slots.forEach(slot => {
    const agenda = agendaMap[slot.kelas + '|' + slot.jam] || { id: null, status: 'Belum diisi' };
    const consecutive = current && current.kelas === slot.kelas && current.mapel === slot.mapel && slot.rowIndex === current.lastRowIndex + 1;

    if (!consecutive) {
      if (current) merged.push(current);
      current = { jam: slot.jam, kelas: slot.kelas, mapel: slot.mapel, agendaId: agenda.id, status: agenda.status, rawJams: [slot.jam], lastRowIndex: slot.rowIndex };
    } else {
      current.jam = current.rawJams[0] + ' - ' + slot.jam;
      current.rawJams.push(slot.jam);
      current.lastRowIndex = slot.rowIndex;
      if (agenda.id) {
        current.agendaId = agenda.id;
        current.status = agenda.status;
      }
    }
  });

  if (current) merged.push(current);
  return merged;
}

function saveAgenda(data) {
  try {
    if (!data || !data.email || !data.tanggal) return { success: false, message: 'Data agenda tidak lengkap.' };
    let sheet = getDb().getSheetByName('AGENDA');
    if (!sheet) {
      sheet = getDb().insertSheet('AGENDA');
      sheet.appendRow(['id', 'email', 'tanggal', 'hari', 'kelas', 'mapel', 'jam', 'materi', 'kegiatan', 'asesmen', 'catatan', 'status', 'created_at']);
    }

    const id = data.id || 'AGD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const rows = sheet.getDataRange().getValues();
    const createdAt = data.created_at || Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss');
    const payload = [id, data.email, data.tanggal, data.hari || '', data.kelas || '', data.mapel || '', data.jam || '', data.materi || '', data.kegiatan || '', data.asesmen || '', data.catatan || '', data.status || 'Draft', createdAt];
    let existingRow = -1;

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === String(id).trim()) {
        if (normalize(getCell(rows[i], 1)) !== normalize(data.email)) {
          return { success: false, message: 'Agenda tidak ditemukan atau akses ditolak.' };
        }
        existingRow = i + 1;
        break;
      }
    }

    if (existingRow > 0) sheet.getRange(existingRow, 1, 1, payload.length).setValues([payload]);
    else sheet.appendRow(payload);
    return { success: true, message: 'Agenda berhasil disimpan.', id };
  } catch (error) {
    return { success: false, message: 'Gagal menyimpan agenda: ' + error.message };
  }
}

function getAgendaHistory(email, filterDate, filterClass, searchQuery) {
  try {
    const data = table('AGENDA');
    if (!data || data.values.length <= 1) return { success: true, agendas: [] };
    const result = [];
    const query = normalize(searchQuery);

    for (let i = 1; i < data.values.length; i++) {
      const row = data.values[i];
      if (normalize(getCell(row, data.headers.email)) !== normalize(email)) continue;
      const item = {
        id: getCell(row, data.headers.id), email: getCell(row, data.headers.email), tanggal: formatDate(getCell(row, data.headers.tanggal)),
        hari: getCell(row, data.headers.hari), kelas: getCell(row, data.headers.kelas), mapel: getCell(row, data.headers.mapel), jam: getCell(row, data.headers.jam),
        materi: getCell(row, data.headers.materi), kegiatan: getCell(row, data.headers.kegiatan), asesmen: getCell(row, data.headers.asesmen), catatan: getCell(row, data.headers.catatan),
        status: getCell(row, data.headers.status), created_at: formatDate(getCell(row, data.headers.created_at), true)
      };
      if (filterDate && item.tanggal !== filterDate) continue;
      if (filterClass && String(item.kelas).trim() !== String(filterClass).trim()) continue;
      if (query && !normalize(item.materi).includes(query) && !normalize(item.kegiatan).includes(query)) continue;
      result.push(item);
    }
    result.sort((a, b) => b.tanggal.localeCompare(a.tanggal));
    return { success: true, agendas: result };
  } catch (error) {
    return { success: false, message: 'Gagal memuat riwayat agenda: ' + error.message };
  }
}

function deleteAgenda(email, agendaId) {
  try {
    const data = table('AGENDA');
    if (!data) return { success: false, message: 'Sheet AGENDA tidak ditemukan.' };
    if (data.headers.id === undefined || data.headers.email === undefined) {
      return { success: false, message: 'Kolom id atau email tidak ditemukan.' };
    }

    const rows = data.values;
    for (let i = 1; i < rows.length; i++) {
      if (String(getCell(rows[i], data.headers.id)).trim() === String(agendaId).trim() &&
          normalize(getCell(rows[i], data.headers.email)) === normalize(email)) {
        data.sheet.deleteRow(i + 1);
        return { success: true, message: 'Agenda berhasil dihapus.' };
      }
    }
    return { success: false, message: 'Agenda tidak ditemukan atau akses ditolak.' };
  } catch (error) {
    return { success: false, message: 'Gagal menghapus agenda: ' + error.message };
  }
}

function exportAgendaPdf(email, filterDate, filterClass, searchQuery, teacherName, subject) {
  try {
    const history = getAgendaHistory(email, filterDate, filterClass, searchQuery);
    if (!history.success) return history;
    if (!history.agendas.length) return { success: false, message: 'Belum ada data riwayat untuk diekspor.' };

    const temporaryBook = SpreadsheetApp.create('Export Agenda Mengajar - ' + new Date().getTime());
    const sheet = temporaryBook.getSheets()[0];
    sheet.setName('Riwayat Agenda');

    const headers = ['No.', 'Tanggal', 'Hari', 'Kelas', 'Jam', 'Materi', 'Kegiatan Pembelajaran', 'Asesmen', 'Catatan', 'Status'];
    const rows = history.agendas.map((item, index) => [
      index + 1, item.tanggal, item.hari, item.kelas, item.jam, item.materi || '-',
      item.kegiatan || '-', item.asesmen || '-', item.catatan || '-', item.status || '-'
    ]);

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e5e7eb');
    sheet.getRange(1, 1, rows.length + 1, headers.length).setWrap(true).setVerticalAlignment('top');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 42);
    sheet.setColumnWidth(2, 78);
    sheet.setColumnWidth(3, 65);
    sheet.setColumnWidth(4, 58);
    sheet.setColumnWidth(5, 82);
    sheet.setColumnWidth(6, 130);
    sheet.setColumnWidth(7, 220);
    sheet.setColumnWidth(8, 120);
    sheet.setColumnWidth(9, 140);
    sheet.setColumnWidth(10, 65);
    SpreadsheetApp.flush();

    const exportUrl = 'https://docs.google.com/spreadsheets/d/' + temporaryBook.getId() + '/export' +
      '?format=pdf&size=7&portrait=true&fitw=true&sheetnames=false&printtitle=false' +
      '&pagenumbers=false&gridlines=false&fzr=true&top_margin=0.7874&bottom_margin=0.5906' +
      '&left_margin=0.4724&right_margin=0.4724';
    const response = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) throw new Error('Gagal membuat file PDF dari Google Sheets.');

    const safeName = String(teacherName || 'Guru').replace(/[\\/:*?"<>|]/g, '-');
    const pdfBlob = response.getBlob().setName('Riwayat Agenda - ' + safeName + '.pdf');
    return {
      success: true,
      filename: pdfBlob.getName(),
      mimeType: pdfBlob.getContentType(),
      base64: Utilities.base64Encode(pdfBlob.getBytes()),
      message: 'PDF berhasil dibuat.'
    };
  } catch (error) {
    return { success: false, message: 'Gagal membuat PDF: ' + error.message };
  }
}

function formatDate(value, includeTime) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Jakarta', includeTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  }
  const text = String(value).trim();
  return includeTime ? text.replace('T', ' ').substring(0, 16) : text.substring(0, 10);
}
