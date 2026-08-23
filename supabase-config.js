/* Isi dua nilai ini dari Supabase Project Settings > API. */
const SUPABASE_URL = 'https://mmqllqwjsfdwggrmgdsr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HaqZW2visEsqF6asBbpQpQ_HNWSWj6a';

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

function isSupabaseConfigured() {
  return !SUPABASE_URL.includes('YOUR_PROJECT') &&
    !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');
}

function apiError(error) {
  throw new Error(error && error.message ? error.message : 'Operasi database gagal.');
}

async function supabaseLogin(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) apiError(error);

  const { data: profile, error: profileError } = await supabaseClient
    .from('profiles')
    .select('email, nama_guru, mapel, kelas')
    .eq('id', data.user.id)
    .single();
  if (profileError) apiError(profileError);

  return {
    success: true,
    user: {
      id: data.user.id,
      email: profile.email,
      namaGuru: profile.nama_guru || 'Guru',
      mapel: profile.mapel || '-',
      kelas: profile.kelas || '-'
    }
  };
}

async function supabaseSchedule(user, dayName, dateStr) {
  const { data, error } = await supabaseClient
    .from('schedules')
    .select('id, jam, kelas, mapel, day_name')
    .eq('teacher_id', user.id)
    .eq('day_name', dayName)
    .order('sort_order', { ascending: true });
  if (error) apiError(error);

  const { data: agendas, error: agendaError } = await supabaseClient
    .from('agendas')
    .select('id, kelas, jam, status')
    .eq('teacher_id', user.id)
    .eq('tanggal', dateStr);
  if (agendaError) apiError(agendaError);

  const agendaMap = {};
  (agendas || []).forEach(item => {
    agendaMap[`${item.kelas}|${item.jam}`] = item;
  });

  return {
    success: true,
    teacherName: user.namaGuru,
    mapel: user.mapel,
    schedule: (data || []).map(item => ({
      jam: item.jam,
      kelas: item.kelas,
      mapel: item.mapel || user.mapel,
      agendaId: agendaMap[`${item.kelas}|${item.jam}`]?.id || null,
      status: agendaMap[`${item.kelas}|${item.jam}`]?.status || 'Belum diisi'
    }))
  };
}

async function supabaseSaveAgenda(payload, user) {
  const row = {
    id: payload.id || crypto.randomUUID(),
    teacher_id: user.id,
    email: user.email,
    tanggal: payload.tanggal,
    hari: payload.hari,
    kelas: payload.kelas,
    mapel: payload.mapel,
    jam: payload.jam,
    materi: payload.materi,
    kegiatan: payload.kegiatan,
    asesmen: payload.asesmen,
    catatan: payload.catatan,
    status: payload.status || 'Draft',
    created_at: payload.created_at || new Date().toISOString()
  };

  const { error } = await supabaseClient.from('agendas').upsert(row);
  if (error) apiError(error);
  return { success: true, message: 'Agenda berhasil disimpan.', id: row.id };
}

async function supabaseHistory(user, filterDate, filterClass, searchQuery) {
  let query = supabaseClient
    .from('agendas')
    .select('*')
    .eq('teacher_id', user.id)
    .order('tanggal', { ascending: false });

  if (filterDate) query = query.eq('tanggal', filterDate);
  if (filterClass) query = query.eq('kelas', filterClass);

  const { data, error } = await query;
  if (error) apiError(error);

  const search = String(searchQuery || '').trim().toLowerCase();
  const agendas = (data || []).filter(item => !search ||
    String(item.materi || '').toLowerCase().includes(search) ||
    String(item.kegiatan || '').toLowerCase().includes(search)
  ).map(item => ({
    id: item.id,
    email: item.email,
    tanggal: item.tanggal,
    hari: item.hari,
    kelas: item.kelas,
    mapel: item.mapel,
    jam: item.jam,
    materi: item.materi,
    kegiatan: item.kegiatan,
    asesmen: item.asesmen,
    catatan: item.catatan,
    status: item.status,
    created_at: item.created_at
  }));

  return { success: true, agendas };
}

async function supabaseDeleteAgenda(agendaId, user) {
  const { data, error } = await supabaseClient
    .from('agendas')
    .delete()
    .eq('id', agendaId)
    .eq('teacher_id', user.id)
    .select('id');
  if (error) apiError(error);
  if (!data || data.length === 0) {
    throw new Error('Agenda tidak ditemukan atau akses ditolak.');
  }
  return { success: true, message: 'Agenda berhasil dihapus.' };
}

if (isSupabaseConfigured()) {
window.google = {
  script: {
    run: {
      _success: null,
      _failure: null,
      withSuccessHandler(handler) {
        this._success = handler;
        return this;
      },
      withFailureHandler(handler) {
        this._failure = handler;
        return this;
      },
      async loginUser(email, password) {
        return this._execute(() => supabaseLogin(email, password));
      },
      async getTeacherSchedule(email, dayName, dateStr) {
        return this._execute(() => supabaseSchedule(currentUser, dayName, dateStr));
      },
      async saveAgenda(payload) {
        return this._execute(() => supabaseSaveAgenda(payload, currentUser));
      },
      async getAgendaHistory(email, date, kelas, search) {
        return this._execute(() => supabaseHistory(currentUser, date, kelas, search));
      },
      async deleteAgenda(email, agendaId) {
        return this._execute(() => supabaseDeleteAgenda(agendaId, currentUser));
      },
      async _execute(operation) {
        try {
          const result = await operation();
          if (this._success) this._success(result);
          return result;
        } catch (error) {
          if (this._failure) this._failure(error);
        } finally {
          this._success = null;
          this._failure = null;
        }
      }
    }
  }
};
}
