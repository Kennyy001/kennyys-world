(() => {
  const cfg = window.KENNNYY_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") && !cfg.SUPABASE_ANON_KEY.includes("PASTE_");
  const db = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const $ = id => document.getElementById(id);
  let user = null;
  function status(id, msg) { $(id).textContent = msg; }
  function showStudio(on) {
    $("studio").classList.toggle("hidden", !on);
    $("manage").classList.toggle("hidden", !on);
    $("logout").classList.toggle("hidden", !on);
    $("login-form").classList.toggle("hidden", on);
  }
  if (!db) status("login-status", "Setup required: add your Supabase URL and publishable/anon key to config.js.");
  else db.auth.getSession().then(({ data }) => { if (data.session) { user = data.session.user; showStudio(true); loadAdminTracks(); } });
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault(); if (!db) return;
    status("login-status", "Signing in…");
    const { data, error } = await db.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
    if (error) return status("login-status", "Sign-in failed. Check your email/password and Supabase setup.");
    user = data.user; status("login-status", "Signed in."); showStudio(true); loadAdminTracks();
  });
  $("logout").addEventListener("click", async () => {
    if (db) await db.auth.signOut();
    user = null; showStudio(false); status("login-status", "Signed out.");
  });
  $("upload-form").addEventListener("submit", async e => {
    e.preventDefault(); if (!db || !user) return status("upload-status", "Sign in first.");
    const title = $("song-title").value.trim(), artist = $("song-artist").value.trim(), language = $("song-language").value;
    const audioFile = $("audio-file").files[0], coverFile = $("cover-file").files[0];
    const lyrics = $("song-lyrics").value.trim();
    const timedLyricsText = $("timed-lyrics").value.trim();
    const timedLyrics = [];
    if (timedLyricsText) {
      for (const rawLine of timedLyricsText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const match = line.match(/^(\d{1,2}:)?([0-5]?\d):([0-5]\d)\s*\|\s*(.+)$/);
        if (!match) return status("upload-status", `Check synchronized lyrics line: "${line}". Use mm:ss|lyric or hh:mm:ss|lyric.`);
        let seconds;
        if (match[1]) seconds = Number(match[1].slice(0, -1)) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        else seconds = Number(match[2]) * 60 + Number(match[3]);
        timedLyrics.push({ time: seconds, text: line.split("|").slice(1).join("|").trim() });
      }
      timedLyrics.sort((a, b) => a.time - b.time);
    }
    if (!audioFile) return;
    if (!audioFile.type.startsWith("audio/")) return status("upload-status", "Please choose an audio file.");
    if (audioFile.size > 40 * 1024 * 1024) return status("upload-status", "This starter limits uploads to 40 MB per song. Compress the audio or adjust your storage plan.");
    const btn = e.currentTarget.querySelector("button"); btn.disabled = true;
    status("upload-status", "Uploading audio…");
    const clean = name => name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100);
    const audioPath = `${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}-${clean(audioFile.name)}`;
    const audioUpload = await db.storage.from("music").upload(audioPath, audioFile, { upsert: false, contentType: audioFile.type || "audio/mpeg" });
    if (audioUpload.error) { btn.disabled = false; return status("upload-status", "Audio upload failed. Check bucket and storage policies."); }
    let coverUrl = null;
    if (coverFile) {
      if (!coverFile.type.startsWith("image/") || coverFile.size > 5 * 1024 * 1024) {
        await db.storage.from("music").remove([audioPath]); btn.disabled = false;
        return status("upload-status", "Cover must be an image smaller than 5 MB.");
      }
      const coverPath = `covers/${Date.now()}-${clean(coverFile.name)}`;
      const coverUpload = await db.storage.from("music").upload(coverPath, coverFile, { upsert: false, contentType: coverFile.type });
      if (coverUpload.error) { await db.storage.from("music").remove([audioPath]); btn.disabled = false; return status("upload-status", "Cover upload failed. Check storage policy."); }
      coverUrl = db.storage.from("music").getPublicUrl(coverPath).data.publicUrl;
    }
    const { error } = await db.from("tracks").insert({ title, artist, language, audio_path: audioPath, cover_url: coverUrl, owner_id: user.id, lyrics, synced_lyrics: timedLyrics });
    btn.disabled = false;
    if (error) { await db.storage.from("music").remove([audioPath]); return status("upload-status", "Track record failed. Check the owner UUID in schema.sql and try again."); }
    $("upload-form").reset(); $("song-artist").value = "Kennyy";
    status("upload-status", "Song published! It should now appear on the public page.");
    loadAdminTracks();
  });
  async function loadAdminTracks() {
    if (!db || !user) return;
    const { data, error } = await db.from("tracks").select("id,title,audio_path,cover_url").order("created_at", { ascending: true });
    if (error) { $("admin-track-list").textContent = "Could not load tracks. Check database policies."; return; }
    $("admin-track-list").innerHTML = data.length ? data.map(t => `<div class="admin-track"><span>${escapeHtml(t.title)}</span><button class="danger" data-delete="${t.id}" data-audio="${escapeHtml(t.audio_path)}" data-cover="${escapeHtml(t.cover_url || "")}">Delete</button></div>`).join("") : '<p class="admin-note">No songs uploaded yet.</p>';
    document.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", async () => {
      if (!confirm("Delete this song from your website?")) return;
      const trackId = btn.dataset.delete, audioPath = btn.dataset.audio, coverUrl = btn.dataset.cover;
      const { error: deleteError } = await db.from("tracks").delete().eq("id", trackId);
      if (deleteError) return alert("Could not delete track. Check owner permissions.");
      const paths = [audioPath];
      if (coverUrl) { try { const url = new URL(coverUrl); const marker = "/object/public/music/"; const pos = url.pathname.indexOf(marker); if (pos >= 0) paths.push(decodeURIComponent(url.pathname.slice(pos + marker.length))); } catch (_) {} }
      await db.storage.from("music").remove(paths);
      loadAdminTracks();
    }));
  }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
})();
