(() => {
  const cfg = window.KENNNYY_CONFIG || {};

  const configured =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") &&
    !cfg.SUPABASE_ANON_KEY.includes("PASTE_");

  const db =
    configured && window.supabase
      ? window.supabase.createClient(
          cfg.SUPABASE_URL,
          cfg.SUPABASE_ANON_KEY
        )
      : null;

  const $ = (id) => document.getElementById(id);
  const audio = $("audio");

  let tracks = [];
  let currentIndex = -1;

  const deviceKey = "kennyy_guest_device";
  let deviceId = localStorage.getItem(deviceKey);

  if (!deviceId) {
    deviceId = crypto.randomUUID
      ? crypto.randomUUID()
      : "guest-" + Math.random().toString(36).slice(2) + Date.now();

    localStorage.setItem(deviceKey, deviceId);
  }

  $("year").textContent = new Date().getFullYear();

  function toast(message) {
    const el = $("toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    setTimeout(() => el.classList.remove("show"), 2600);
  }

  function time(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";

    return (
      Math.floor(seconds / 60) +
      ":" +
      String(Math.floor(seconds % 60)).padStart(2, "0")
    );
  }

  function safeText(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch]
    );
  }

  async function loadTracks() {
    if (!db) {
      $("track-count").textContent = "Setup needed";

      $("track-list").innerHTML =
        '<div class="empty-state">' +
        "<span class=\"pulse\">♫</span>" +
        "<h3>Kennyy&#39;s World is waiting</h3>" +
        "<p>Connect your free Supabase project using the setup guide, " +
        "then sign in to the owner page to upload your first song.</p>" +
        "</div>";

      return;
    }

    const { data, error } = await db
      .from("tracks")
      .select(
        "id,title,artist,language,cover_url,audio_path,created_at,like_count,lyrics,synced_lyrics"
      )
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Could not load tracks:", error);

      $("track-list").innerHTML =
        '<div class="empty-state">' +
        "<h3>Could not load tracks</h3>" +
        "<p>Check your Supabase setup and database policies.</p>" +
        "</div>";

      return;
    }

    tracks = data || [];

    $("track-count").textContent =
      `${tracks.length} track${tracks.length === 1 ? "" : "s"}`;

    if (!tracks.length) {
      $("track-list").innerHTML =
        '<div class="empty-state">' +
        "<span class=\"pulse\">♫</span>" +
        "<h3>Your first release starts here</h3>" +
        "<p>Open Owner login to upload your original songs. " +
        "They will show up here automatically.</p>" +
        "</div>";

      return;
    }

    const { data: likedRows } = await db
      .from("likes")
      .select("track_id")
      .eq("device_id", deviceId);

    const liked = new Set(
      (likedRows || []).map((row) => row.track_id)
    );

    function renderTracks() {
      const language = $("language-filter")?.value || "all";

      const visibleTracks = tracks.filter(
        (track) =>
          language === "all" ||
          (track.language || "Other") === language
      );

      $("track-list").innerHTML = visibleTracks.length
        ? visibleTracks
            .map(
              (track, visibleIndex) => `
        <article class="track-row">
          <span class="track-number">
            ${String(visibleIndex + 1).padStart(2, "0")}
          </span>

          <div class="cover">
            ${
              track.cover_url
                ? `<img src="${safeText(track.cover_url)}" alt="">`
                : "K"
            }
          </div>

          <button
            class="track-meta track-play"
            data-index="${tracks.indexOf(track)}"
            style="text-align:left;background:none;border:0;color:inherit;padding:0;cursor:pointer;min-width:0"
          >
            <span class="track-title">
              ${safeText(track.title)}
            </span>

            <span class="track-sub">
              ${safeText(track.artist || "Kennyy")} ·
              ${safeText(track.language || "Other")}
            </span>
          </button>

          <span
            class="track-duration"
            id="duration-${safeText(track.id)}"
          >♫</span>

          <button
            class="like-btn ${liked.has(track.id) ? "liked" : ""}"
            data-like="${safeText(track.id)}"
            aria-label="Like ${safeText(track.title)}"
            title="Like song"
          >
            ♥
            <small style="font-size:10px;display:block">
              ${track.like_count || 0}
            </small>
          </button>
        </article>
      `
            )
            .join("")
        : '<div class="empty-state">' +
          "<h3>No songs in this language yet</h3>" +
          "<p>Choose another language or select All languages.</p>" +
          "</div>";

      document.querySelectorAll(".track-play").forEach((btn) => {
        btn.addEventListener("click", () => {
          playTrack(Number(btn.dataset.index));
        });
      });

      document.querySelectorAll("[data-like]").forEach((btn) => {
        btn.addEventListener("click", () => {
          toggleLike(btn.dataset.like, btn);
        });
      });
    }

    renderTracks();

    $("language-filter")?.addEventListener("change", renderTracks);
  }

  // Play a song using audio_path from the tracks table.
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

    // If audio_path is already a full URL, use it directly.
    // Otherwise, use it as a path inside the Supabase "music" bucket.

    if (/^https?:\/\//i.test(audioPath)) {
      audio.src = audioPath;
    } else {
      const { data, error } = db.storage
        .from("music")
        .getPublicUrl(audioPath);

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

    $("toggle-play").textContent = "▶";

    audio.load();

    try {
      await audio.play();

      $("toggle-play").textContent = "Ⅱ";
    } catch (error) {
      console.error(
        "Audio playback failed:",
        error,
        "Audio URL:",
        audio.src
      );

      if (error && error.name === "NotAllowedError") {
        toast("Press the play button once to allow audio.");
      } else {
        toast(
          "Song could not play. Check the audio file path and access."
        );
      }

      $("toggle-play").textContent = "▶";
    }
  }

  // Show a message if the audio file fails to load.
  audio.addEventListener("error", () => {
    console.error(
      "Audio element error:",
      audio.error,
      "Audio URL:",
      audio.src
    );

    toast(
      "Audio file could not load. Check the music bucket and file path."
    );

    $("toggle-play").textContent = "▶";
  });

  function renderLyrics(track) {
    $("lyrics-song-title").textContent = track
      ? `${track.title} — Lyrics`
      : "Song Lyrics";

    $("lyrics-language").textContent = track
      ? track.language || "Other"
      : "Choose a track";

    $("full-lyrics").textContent =
      track && track.lyrics
        ? track.lyrics
        : "Full lyrics have not been added for this song yet.";

    $("full-lyrics-details").open = Boolean(
      track && track.lyrics
    );

    const timed = Array.isArray(track?.synced_lyrics)
      ? track.synced_lyrics
      : [];

    $("synced-lyrics").textContent = timed.length
      ? "Press play to follow the lyrics."
      : "Synchronized lyrics have not been added for this song yet.";

    $("synced-lyrics").classList.toggle(
      "has-timed-lyrics",
      timed.length > 0
    );
  }

  function updateSyncedLyrics() {
    const track = tracks[currentIndex];

    const timed = Array.isArray(track?.synced_lyrics)
      ? track.synced_lyrics
      : [];

    if (!timed.length) return;

    let active = -1;

    for (let i = 0; i < timed.length; i++) {
      if (audio.currentTime >= Number(timed[i].time)) {
        active = i;
      } else {
        break;
      }
    }

    const el = $("synced-lyrics");

    if (active < 0) {
      el.textContent = "Get ready…";
      return;
    }

    el.textContent = timed[active].text || "";

    el.dataset.line = String(active + 1);
  }

  async function toggleLike(trackId, button) {
    if (!db) {
      return toast("Connect Supabase first to enable likes.");
    }

    const liked = button.classList.contains("liked");

    button.disabled = true;

    const result = liked
      ? await db
          .from("likes")
          .delete()
          .eq("track_id", trackId)
          .eq("device_id", deviceId)
      : await db
          .from("likes")
          .insert({
            track_id: trackId,
            device_id: deviceId,
          });

    button.disabled = false;

    if (result.error) {
      return toast("Could not update like. Please try again.");
    }

    await loadTracks();
  }

  $("play-all").addEventListener("click", () => {
    tracks.length
      ? playTrack(0)
      : toast("Your songs will appear after setup.");
  });

  $("toggle-play").addEventListener("click", async () => {
    if (!audio.src) {
      return tracks.length
        ? playTrack(0)
        : toast("Upload your songs first.");
    }

    if (audio.paused) {
      try {
        await audio.play();

        $("toggle-play").textContent = "Ⅱ";
      } catch (error) {
        console.error("Play button failed:", error);

        toast(
          "Song could not play. Check the audio file path and access."
        );
      }
    } else {
      audio.pause();

      $("toggle-play").textContent = "▶";
    }
  });

  $("prev-track").addEventListener("click", () => {
    if (tracks.length) {
      playTrack(
        (currentIndex - 1 + tracks.length) % tracks.length
      );
    }
  });

  $("next-track").addEventListener("click", () => {
    if (tracks.length) {
      playTrack((currentIndex + 1) % tracks.length);
    }
  });

  audio.addEventListener("ended", () => {
    if (tracks.length) {
      playTrack((currentIndex + 1) % tracks.length);
    }
  });

  audio.addEventListener("play", () => {
    $("toggle-play").textContent = "Ⅱ";
  });

  audio.addEventListener("pause", () => {
    $("toggle-play").textContent = "▶";
  });

  audio.addEventListener("loadedmetadata", () => {
    $("duration").textContent = time(audio.duration);
  });

  audio.addEventListener("timeupdate", () => {
    $("current-time").textContent = time(audio.currentTime);

    $("seek").value = audio.duration
      ? (audio.currentTime / audio.duration) * 100
      : 0;

    updateSyncedLyrics();
  });

  $("seek").addEventListener("input", (e) => {
    if (audio.duration) {
      audio.currentTime =
        (audio.duration * Number(e.target.value)) / 100;
    }
  });

  $("volume").addEventListener("input", (e) => {
    audio.volume = Number(e.target.value);
  });

  async function loadComments() {
    if (!db) return;

    const { data, error } = await db
      .from("comments")
      .select("id,nickname,body,created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      $("comment-list").innerHTML =
        '<p class="muted">Comments are not available yet. Check the database setup.</p>';

      return;
    }

    if (!data.length) {
      $("comment-list").innerHTML =
        '<p class="muted">Be the first to leave Kennyy a message.</p>';

      return;
    }

    $("comment-list").innerHTML = data
      .map(
        (c) => `
        <article class="comment">
          <div class="avatar">
            ${safeText(
              (c.nickname || "G").trim().charAt(0).toUpperCase()
            )}
          </div>

          <div class="comment-body">
            <div class="comment-head">
              <strong>${safeText(c.nickname)}</strong>
              <time>${new Date(c.created_at).toLocaleDateString()}</time>
            </div>

            <p>${safeText(c.body)}</p>
          </div>
        </article>
      `
      )
      .join("");
  }

  $("comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const nickname = $("guest-name").value.trim();

    const body = $("guest-comment").value.trim();

    if (!nickname || !body) return;

    if (!db) {
      $("comment-status").textContent =
        "Connect your Supabase project first; then guest comments will work.";

      return;
    }

    if (body.length > 500 || nickname.length > 32) return;

    const btn = e.currentTarget.querySelector("button");

    btn.disabled = true;

    const { error } = await db
      .from("comments")
      .insert({ nickname, body });

    btn.disabled = false;

    if (error) {
      $("comment-status").textContent =
        "Could not post. Please try again in a moment.";

      return;
    }

    $("guest-comment").value = "";

    $("comment-status").textContent =
      "Your comment has been posted.";

    await loadComments();
  });

  loadTracks();

  loadComments();
})();