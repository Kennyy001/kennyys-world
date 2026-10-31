(() => {
  const cfg = window.KENNNYY_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") && !cfg.SUPABASE_ANON_KEY.includes("PASTE_");
  const db = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const $ = (id) => document.getElementById(id);
  const audio = $("audio");
  let tracks = [];
  let currentIndex = -1;
  let shuffleOn = false;
  let repeatMode = "off"; // off, all, one
  const deviceKey = "kennyy_guest_device";
  let deviceId = localStorage.getItem(deviceKey);
  if (!deviceId) {
    deviceId = (crypto.randomUUID ? crypto.randomUUID() : "guest-" + Math.random().toString(36).slice(2) + Date.now());
    localStorage.setItem(deviceKey, deviceId);
  }
  $("year").textContent = new Date().getFullYear();

  function toast(message) {
    const el = $("toast"); el.textContent = message; el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2600);
  }
  function time(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    return Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
  }
  function safeText(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch])); }

  async function loadTracks() {
    if (!db) {
      $("track-count").textContent = "Setup needed";
      $("track-list").innerHTML = '<div class="empty-state"><span class="pulse">♫</span><h3>Kennyy&#39;s World is waiting</h3><p>Connect your free Supabase project using the setup guide, then sign in to the owner page to upload your first song.</p></div>';
      return;
    }
    const { data, error } = await db.from("tracks").select("id,title,artist,language,cover_url,audio_path,created_at,like_count,lyrics,synced_lyrics").order("created_at", { ascending: true });
    if (error) { $("track-list").innerHTML = '<div class="empty-state"><h3>Could not load tracks</h3><p>Check your Supabase setup and database policies.</p></div>'; return; }
    tracks = data || [];
    $("track-count").textContent = `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;
    if (!tracks.length) {
      $("track-list").innerHTML = '<div class="empty-state"><span class="pulse">♫</span><h3>Your first release starts here</h3><p>Open Owner login to upload your original songs. They will show up here automatically.</p></div>';
      return;
    }
    const { data: likedRows } = await db.from("likes").select("track_id").eq("device_id", deviceId);
    const liked = new Set((likedRows || []).map(row => row.track_id));
    function renderTracks() {
      const language = $("language-filter")?.value || "all";
      const visibleTracks = tracks.filter(track => language === "all" || (track.language || "Other") === language);
      $("track-list").innerHTML = visibleTracks.length ? visibleTracks.map((track, visibleIndex) => `
        <article class="track-row">
          <span class="track-number">${String(visibleIndex + 1).padStart(2, "0")}</span>
          <div class="cover">${track.cover_url ? `<img src="${safeText(track.cover_url)}" alt="">` : '<img src="assets/3Logo.png" alt="">'}</div>
          <button class="track-meta track-play" data-index="${tracks.indexOf(track)}" style="text-align:left;background:none;border:0;color:inherit;padding:0;cursor:pointer;min-width:0">
            <span class="track-title">${safeText(track.title)}</span><span class="track-sub">${safeText(track.artist || "Kennyy")} · ${safeText(track.language || "Other")}</span>
          </button>
          <span class="track-duration" id="duration-${track.id}">♫</span>
          <button class="like-btn ${liked.has(track.id) ? "liked" : ""}" data-like="${track.id}" aria-label="Like ${safeText(track.title)}" title="Like song">♥<small style="font-size:10px;display:block">${track.like_count || 0}</small></button>
        </article>`).join("") : '<div class="empty-state"><h3>No songs in this language yet</h3><p>Choose another language or select All languages.</p></div>';
      document.querySelectorAll(".track-play").forEach(btn => btn.addEventListener("click", () => playTrack(Number(btn.dataset.index))));
      document.querySelectorAll("[data-like]").forEach(btn => btn.addEventListener("click", () => toggleLike(btn.dataset.like, btn)));
    }
    renderTracks();
    if (currentIndex >= 0 && tracks[currentIndex]) {
      const activeLike = liked.has(tracks[currentIndex].id);
      $("player-like").classList.toggle("liked", activeLike);
      $("player-like").textContent = activeLike ? "♥" : "♡";
    }
    if (!$("language-filter").dataset.bound) {
      $("language-filter").addEventListener("change", renderTracks);
      $("language-filter").dataset.bound = "1";
    }
  }

  async function playTrack(index) {
    if (!tracks[index] || !db) return;

    currentIndex = index;
    const track = tracks[index];
    renderLyrics(track);

    const audioPath = String(track.audio_path || "").trim();
    if (!audioPath) {
      console.error("Missing audio_path for track:", track);
      toast("This track has no audio file path.");
      $("toggle-play").textContent = "▶";
      return;
    }

    // If audio_path is already a full HTTP(S) URL, use it directly.
    // Otherwise, treat it as a file path inside the Supabase Storage "music" bucket.
    if (/^https?:\/\//i.test(audioPath)) {
      audio.src = audioPath;
    } else {
      const { data, error } = db.storage.from("music").getPublicUrl(audioPath);
      if (error || !data?.publicUrl) {
        console.error("Could not create public audio URL:", error);
        toast("Could not create the audio URL. Check the music bucket.");
        $("toggle-play").textContent = "▶";
        return;
      }
      audio.src = data.publicUrl;
    }

    $("now-title").textContent = track.title || "Unknown title";
    $("now-artist").textContent = track.artist || "Kennyy";
    $("now-cover").src = track.cover_url || "assets/3Logo.png";
    $("now-cover").onerror = () => { $("now-cover").src = "assets/3Logo.png"; };
    $("player-like").classList.toggle("liked", document.querySelector(`[data-like="${CSS.escape(String(track.id))}"]`)?.classList.contains("liked") || false);
    $("player-like").textContent = $("player-like").classList.contains("liked") ? "♥" : "♡";
    $("toggle-play").textContent = "▶";
    audio.load();

    try {
      await audio.play();
      $("toggle-play").textContent = "Ⅱ";
    } catch (error) {
      console.error("Audio playback failed:", error, "Audio URL:", audio.src);
      if (error?.name === "NotAllowedError") {
        toast("Press the play button once to allow audio.");
      } else {
        toast("Song could not play. Check the audio file path and access.");
      }
      $("toggle-play").textContent = "▶";
    }
  }

  audio.addEventListener("error", () => {
    console.error("Audio element error:", audio.error, "Audio URL:", audio.src);
    toast("Audio file could not load. Check the music bucket and file path.");
    $("toggle-play").textContent = "▶";
  });
  function renderLyrics(track) {
    $("lyrics-song-title").textContent = track ? `${track.title} — Lyrics` : "Song Lyrics";
    $("lyrics-language").textContent = track ? (track.language || "Other") : "Choose a track";
    $("full-lyrics").textContent = track && track.lyrics ? track.lyrics : "Full lyrics have not been added for this song yet.";
    $("full-lyrics-details").open = Boolean(track && track.lyrics);
    const timed = Array.isArray(track?.synced_lyrics) ? track.synced_lyrics : [];
    $("synced-lyrics").textContent = timed.length ? "Press play to follow the lyrics." : "Synchronized lyrics have not been added for this song yet.";
    $("synced-lyrics").classList.toggle("has-timed-lyrics", timed.length > 0);
  }
  function updateSyncedLyrics() {
    const track = tracks[currentIndex];
    const timed = Array.isArray(track?.synced_lyrics) ? track.synced_lyrics : [];
    if (!timed.length) return;
    let active = -1;
    for (let i = 0; i < timed.length; i++) {
      if (audio.currentTime >= Number(timed[i].time)) active = i;
      else break;
    }
    const el = $("synced-lyrics");
    if (active < 0) { el.textContent = "Get ready…"; return; }
    el.textContent = timed[active].text || "";
    el.dataset.line = String(active + 1);
  }

  async function toggleLike(trackId, button) {
    if (!db) return toast("Connect Supabase first to enable likes.");
    const liked = button.classList.contains("liked");
    button.disabled = true;
    const result = liked
      ? await db.from("likes").delete().eq("track_id", trackId).eq("device_id", deviceId)
      : await db.from("likes").insert({ track_id: trackId, device_id: deviceId });
    button.disabled = false;
    if (result.error) return toast("Could not update like. Please try again.");
    await loadTracks();
  }
  function updateModes() {
    const shuffle = $("shuffle"), repeat = $("repeat-mode");
    shuffle.classList.toggle("active", shuffleOn);
    shuffle.setAttribute("aria-label", shuffleOn ? "Shuffle on" : "Shuffle off");
    repeat.classList.toggle("active", repeatMode !== "off");
    repeat.textContent = repeatMode === "one" ? "↻¹" : "↻";
    repeat.title = "Repeat " + repeatMode;
    repeat.setAttribute("aria-label", "Repeat " + repeatMode);
    audio.loop = repeatMode === "one";
  }
  function nextIndex() {
    if (!tracks.length) return -1;
    if (shuffleOn && tracks.length > 1) {
      let candidate = currentIndex;
      while (candidate === currentIndex) candidate = Math.floor(Math.random() * tracks.length);
      return candidate;
    }
    return (currentIndex + 1) % tracks.length;
  }
  async function togglePlayerLike() {
    if (currentIndex < 0 || !tracks[currentIndex]) return toast("Choose a song first.");
    const id = tracks[currentIndex].id;
    const rowButton = document.querySelector(`[data-like="${CSS.escape(String(id))}"]`);
    if (rowButton) return toggleLike(String(id), rowButton);
    if (!db) return toast("Connect Supabase first to enable likes.");
    const { data } = await db.from("likes").select("track_id").eq("track_id", id).eq("device_id", deviceId).maybeSingle();
    const result = data
      ? await db.from("likes").delete().eq("track_id", id).eq("device_id", deviceId)
      : await db.from("likes").insert({ track_id: id, device_id: deviceId });
    if (result.error) return toast("Could not update like. Please try again.");
    $("player-like").classList.toggle("liked", !data);
    $("player-like").textContent = data ? "♡" : "♥";
    await loadTracks();
  }
  $("play-all").addEventListener("click", () => tracks.length ? playTrack(0) : toast("Your songs will appear after setup."));
  $("toggle-play").addEventListener("click", async () => {
    if (!audio.src) return tracks.length ? playTrack(0) : toast("Upload your songs first.");
    if (audio.paused) { try { await audio.play(); } catch (_) {} } else audio.pause();
  });
  $("prev-track").addEventListener("click", () => {
    if (!tracks.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    playTrack((currentIndex - 1 + tracks.length) % tracks.length);
  });
  $("next-track").addEventListener("click", () => tracks.length && playTrack(nextIndex()));
  $("seek-back").addEventListener("click", () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
  $("seek-forward").addEventListener("click", () => { audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + 10); });
  $("shuffle").addEventListener("click", () => { shuffleOn = !shuffleOn; updateModes(); });
  $("repeat-mode").addEventListener("click", () => { repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off"; updateModes(); });
  $("player-like").addEventListener("click", togglePlayerLike);
  audio.addEventListener("ended", () => {
    if (!tracks.length || repeatMode === "one") return;
    if (repeatMode === "all" || currentIndex < tracks.length - 1 || shuffleOn) playTrack(nextIndex());
  });
  updateModes();
  audio.addEventListener("play", () => $("toggle-play").textContent = "Ⅱ");
  audio.addEventListener("pause", () => $("toggle-play").textContent = "▶");
  audio.addEventListener("loadedmetadata", () => $("duration").textContent = time(audio.duration));
  audio.addEventListener("timeupdate", () => {
    $("current-time").textContent = time(audio.currentTime);
    $("seek").value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    updateSyncedLyrics();
  });
  $("seek").addEventListener("input", e => { if (audio.duration) audio.currentTime = audio.duration * Number(e.target.value) / 100; });
  audio.volume = Number($("volume").value);
  $("volume").addEventListener("input", e => audio.volume = Number(e.target.value));

  async function loadComments() {
    if (!db) return;
    const { data, error } = await db.from("comments").select("id,nickname,body,created_at").order("created_at", { ascending: false }).limit(50);
    if (error) { $("comment-list").innerHTML = '<p class="muted">Comments are not available yet. Check the database setup.</p>'; return; }
    if (!data.length) { $("comment-list").innerHTML = '<p class="muted">Be the first to leave Kennyy a message.</p>'; return; }
    $("comment-list").innerHTML = data.map(c => `<article class="comment"><div class="avatar">${safeText((c.nickname || "G").trim().charAt(0).toUpperCase())}</div><div class="comment-body"><div class="comment-head"><strong>${safeText(c.nickname)}</strong><time>${new Date(c.created_at).toLocaleDateString()}</time></div><p>${safeText(c.body)}</p></div></article>`).join("");
  }
  $("comment-form").addEventListener("submit", async e => {
    e.preventDefault();
    const nickname = $("guest-name").value.trim();
    const body = $("guest-comment").value.trim();
    if (!nickname || !body) return;
    if (!db) { $("comment-status").textContent = "Connect your Supabase project first; then guest comments will work."; return; }
    if (body.length > 500 || nickname.length > 32) return;
    const btn = e.currentTarget.querySelector("button"); btn.disabled = true;
    const { error } = await db.from("comments").insert({ nickname, body });
    btn.disabled = false;
    if (error) { $("comment-status").textContent = "Could not post. Please try again in a moment."; return; }
    $("guest-comment").value = ""; $("comment-status").textContent = "Your comment has been posted.";
    await loadComments();
  });
  loadTracks();
  loadComments();
})();
