(() => {
  const cfg = window.KENNNYY_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") && !cfg.SUPABASE_ANON_KEY.includes("PASTE_");
  const db = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  const $ = id => document.getElementById(id);
  let user = null;
  let tracksCache = [];

  function status(id, msg) {
    const el = $(id);
    if (el) el.textContent = msg;
  }

  function showStudio(on) {
    $("studio").classList.toggle("hidden", !on);
    $("manage").classList.toggle("hidden", !on);
    $("logout").classList.toggle("hidden", !on);
    $("login-form").classList.toggle("hidden", on);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function safeId(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "");
  }

  function storagePathFromPublicUrl(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const marker = "/object/public/music/";
      const pos = parsed.pathname.indexOf(marker);
      return pos >= 0 ? decodeURIComponent(parsed.pathname.slice(pos + marker.length)) : null;
    } catch (_) {
      return null;
    }
  }

  function cleanFileName(name) {
    return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(-100);
  }

  if (!db) {
    status("login-status", "Setup required: add your Supabase URL and publishable/anon key to config.js.");
  } else {
    db.auth.getSession().then(({ data, error }) => {
      if (error) return status("login-status", "Could not check your session. Please sign in.");
      if (data.session) {
        user = data.session.user;
        showStudio(true);
        loadAdminTracks();
      }
    });
  }

  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!db) return;
    status("login-status", "Signing in…");
    const { data, error } = await db.auth.signInWithPassword({
      email: $("email").value.trim(),
      password: $("password").value
    });
    if (error) return status("login-status", "Sign-in failed. Check your email/password and Supabase setup.");
    user = data.user;
    status("login-status", "Signed in.");
    showStudio(true);
    loadAdminTracks();
  });

  $("logout").addEventListener("click", async () => {
    if (db) await db.auth.signOut();
    user = null;
    showStudio(false);
    status("login-status", "Signed out.");
  });

  $("upload-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!db || !user) return status("upload-status", "Sign in first.");

    const title = $("song-title").value.trim();
    const artist = $("song-artist").value.trim();
    const language = $("song-language").value;
    const audioFile = $("audio-file").files[0];
    const coverFile = $("cover-file").files[0];
    const lyrics = $("song-lyrics").value.trim();
    const timedLyricsText = $("timed-lyrics").value.trim();
    const timedLyrics = [];

    if (timedLyricsText) {
      for (const rawLine of timedLyricsText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const match = line.match(/^((?:\d{1,2}:)?[0-5]?\d):([0-5]\d)\s*\|\s*(.+)$/);
        if (!match) return status("upload-status", `Check synchronized lyrics line: "${line}". Use mm:ss|lyric or hh:mm:ss|lyric.`);
        const timeParts = match[1].split(":").map(Number);
        const seconds = timeParts.length === 2
          ? timeParts[0] * 60 + timeParts[1]
          : timeParts[0] * 3600 + timeParts[1] * 60 + Number(match[2]);
        timedLyrics.push({ time: seconds, text: match[3].trim() });
      }
      timedLyrics.sort((a, b) => a.time - b.time);
    }

    if (!audioFile) return status("upload-status", "Please choose an audio file.");
    if (!audioFile.type.startsWith("audio/")) return status("upload-status", "Please choose a valid audio file.");
    if (audioFile.size > 40 * 1024 * 1024) return status("upload-status", "This starter limits uploads to 40 MB per song.");

    const btn = e.currentTarget.querySelector('button[type="submit"]');
    btn.disabled = true;
    status("upload-status", "Uploading audio…");

    const audioPath = `${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}-${cleanFileName(audioFile.name)}`;
    const audioUpload = await db.storage.from("music").upload(audioPath, audioFile, {
      upsert: false,
      contentType: audioFile.type || "audio/mpeg"
    });

    if (audioUpload.error) {
      btn.disabled = false;
      return status("upload-status", "Audio upload failed. Check bucket and storage policies.");
    }

    let coverUrl = null;
    let coverPath = null;
    if (coverFile) {
      if (!coverFile.type.startsWith("image/") || coverFile.size > 5 * 1024 * 1024) {
        await db.storage.from("music").remove([audioPath]);
        btn.disabled = false;
        return status("upload-status", "Cover must be an image smaller than 5 MB.");
      }
      coverPath = `covers/${Date.now()}-${cleanFileName(coverFile.name)}`;
      const coverUpload = await db.storage.from("music").upload(coverPath, coverFile, {
        upsert: false,
        contentType: coverFile.type
      });
      if (coverUpload.error) {
        await db.storage.from("music").remove([audioPath]);
        btn.disabled = false;
        return status("upload-status", "Cover upload failed. Check storage policy.");
      }
      coverUrl = db.storage.from("music").getPublicUrl(coverPath).data.publicUrl;
    }

    const { error } = await db.from("tracks").insert({
      title, artist, language, audio_path: audioPath, cover_url: coverUrl,
      owner_id: user.id, lyrics, synced_lyrics: timedLyrics
    });

    btn.disabled = false;
    if (error) {
      await db.storage.from("music").remove([audioPath, ...(coverPath ? [coverPath] : [])]);
      return status("upload-status", "Track record failed. Check the owner UUID in schema.sql and try again.");
    }

    $("upload-form").reset();
    $("song-artist").value = "Kennyy";
    status("upload-status", "Song published! It should now appear on the public page.");
    loadAdminTracks();
  });

  async function loadAdminTracks() {
    if (!db || !user) return;
    const { data, error } = await db.from("tracks")
      .select("id,title,artist,language,audio_path,cover_url")
      .order("created_at", { ascending: true });

    if (error) {
      $("admin-track-list").textContent = "Could not load tracks. Check database policies.";
      return;
    }

    tracksCache = data || [];
    renderAdminTracks();
  }

  function renderAdminTracks() {
    const host = $("admin-track-list");
    if (!tracksCache.length) {
      host.innerHTML = '<p class="admin-note">No songs uploaded yet.</p>';
      return;
    }

    host.innerHTML = tracksCache.map(track => {
      const id = safeId(track.id);
      const cover = track.cover_url
        ? `<img src="${escapeHtml(track.cover_url)}" alt="" class="admin-track-cover">`
        : '<div class="admin-track-cover admin-track-cover-empty">♫</div>';
      return `
        <div class="admin-track" data-track-row="${id}">
          <div class="admin-track-info">
            ${cover}
            <div class="admin-track-text">
              <strong>${escapeHtml(track.title)}</strong>
              <small>${escapeHtml(track.artist || "Kennyy")} · ${escapeHtml(track.language || "Other")}</small>
            </div>
          </div>
          <div class="admin-track-actions">
            <button type="button" class="admin-edit-btn" data-edit="${id}">Edit</button>
            <button type="button" class="danger" data-delete="${id}">Delete</button>
          </div>
        </div>
        <div class="admin-editor hidden" id="editor-${id}">
          <form class="admin-edit-form" data-edit-form="${id}">
            <div class="admin-edit-grid">
              <label>Song title<input name="title" maxlength="100" required value="${escapeHtml(track.title)}"></label>
              <label>Artist name<input name="artist" maxlength="100" required value="${escapeHtml(track.artist || "Kennyy")}"></label>
              <label>Category / language
                <select name="language">
                  ${["English","Hindi","Bengali","Punjabi","Tamil","Telugu","Other"].map(lang =>
                    `<option value="${lang}" ${track.language === lang ? "selected" : ""}>${lang}</option>`
                  ).join("")}
                </select>
              </label>
              <label>Replace cover image<input name="cover" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
            </div>
            <div class="admin-edit-current-cover">
              ${track.cover_url ? `<img src="${escapeHtml(track.cover_url)}" alt="Current cover">` : "<span>No cover image currently set</span>"}
              <label class="admin-remove-cover"><input name="removeCover" type="checkbox"> Remove current cover</label>
            </div>
            <div class="admin-edit-actions">
              <button class="btn btn-green" type="submit">Save changes</button>
              <button class="btn btn-outline" type="button" data-cancel="${id}">Cancel</button>
              <span class="admin-edit-status" aria-live="polite"></span>
            </div>
          </form>
        </div>`;
    }).join("");

    host.querySelectorAll("[data-edit]").forEach(button => {
      button.addEventListener("click", () => {
        const editor = $(`editor-${button.dataset.edit}`);
        editor.classList.toggle("hidden");
      });
    });

    host.querySelectorAll("[data-cancel]").forEach(button => {
      button.addEventListener("click", () => $(`editor-${button.dataset.cancel}`).classList.add("hidden"));
    });

    host.querySelectorAll("[data-edit-form]").forEach(form => {
      form.addEventListener("submit", saveTrackEdits);
    });

    host.querySelectorAll("[data-delete]").forEach(button => {
      button.addEventListener("click", () => deleteTrack(button.dataset.delete));
    });
  }

  async function saveTrackEdits(e) {
    e.preventDefault();
    if (!db || !user) return;
    const form = e.currentTarget;
    const trackId = form.dataset.editForm;
    const track = tracksCache.find(item => String(item.id) === trackId);
    if (!track) return;

    const title = form.elements.title.value.trim();
    const artist = form.elements.artist.value.trim();
    const language = form.elements.language.value;
    const coverFile = form.elements.cover.files[0];
    const removeCover = form.elements.removeCover.checked;
    const saveButton = form.querySelector('button[type="submit"]');
    const message = form.querySelector(".admin-edit-status");

    if (!title || !artist) {
      message.textContent = "Song title and artist are required.";
      return;
    }
    if (coverFile && (!coverFile.type.startsWith("image/") || coverFile.size > 5 * 1024 * 1024)) {
      message.textContent = "Choose an image smaller than 5 MB.";
      return;
    }

    saveButton.disabled = true;
    message.textContent = "Saving changes…";

    let newCoverUrl = track.cover_url || null;
    let newCoverPath = null;

    if (coverFile) {
      newCoverPath = `covers/${Date.now()}-${cleanFileName(coverFile.name)}`;
      const upload = await db.storage.from("music").upload(newCoverPath, coverFile, {
        upsert: false,
        contentType: coverFile.type
      });
      if (upload.error) {
        saveButton.disabled = false;
        message.textContent = "Cover upload failed. Check your music bucket storage policy.";
        return;
      }
      newCoverUrl = db.storage.from("music").getPublicUrl(newCoverPath).data.publicUrl;
    } else if (removeCover) {
      newCoverUrl = null;
    }

    const updates = { title, artist, language, cover_url: newCoverUrl };
    const { error } = await db.from("tracks").update(updates).eq("id", track.id);

    if (error) {
      if (newCoverPath) await db.storage.from("music").remove([newCoverPath]);
      saveButton.disabled = false;
      message.textContent = "Could not save changes. Check your Supabase update policy.";
      return;
    }

    // Remove the old cover only after the database points to the new one.
    if ((coverFile || removeCover) && track.cover_url) {
      const oldPath = storagePathFromPublicUrl(track.cover_url);
      if (oldPath) await db.storage.from("music").remove([oldPath]);
    }

    message.textContent = "Saved!";
    await loadAdminTracks();
  }

  async function deleteTrack(trackId) {
    const track = tracksCache.find(item => String(item.id) === trackId);
    if (!track || !confirm(`Delete "${track.title}" from your website?`)) return;

    const { error } = await db.from("tracks").delete().eq("id", track.id);
    if (error) {
      alert("Could not delete track. Check owner permissions.");
      return;
    }

    const paths = [track.audio_path, storagePathFromPublicUrl(track.cover_url)].filter(Boolean);
    if (paths.length) await db.storage.from("music").remove(paths);
    loadAdminTracks();
  }
})();
