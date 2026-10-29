# Kennyy's World — beginner setup

This is a Spotify-inspired artist page starter. It includes a public music page, guest likes/comments, and an owner-only upload page.

## What is included
- `index.html` — public website
- `admin.html` — private owner sign-in and upload page
- `styles.css` — responsive dark/green styling
- `app.js`, `admin.js` — website behavior
- `config.js` — your Supabase project URL and public key
- `schema.sql` — database tables and security policies

## Part 1 — create your database (Supabase)
1. Open https://supabase.com/ and create a free project. Save your database password somewhere private.
2. In Supabase, open **Project Settings → API** (or the API Keys page). Copy the Project URL and the **publishable key** (or legacy anon key). Never copy a `service_role` or secret key into this website.
3. Open `config.js` and replace the two `PASTE_...` values with your Project URL and public publishable/anon key.
4. In Supabase, open **Authentication → Users** and create your owner user with your email and a strong password. If the dashboard does not offer a create-user option, enable email/password temporarily, sign up, then disable public signups immediately.
5. Copy the owner's **User UID** from Authentication → Users.
6. Open `schema.sql` in a text editor. Replace every occurrence of `OWNER_USER_UUID_HERE` with that exact UUID. Do not leave the placeholder in place.
7. Open **SQL Editor** in Supabase, paste the edited SQL, and click Run.
8. In **Authentication → Providers / Sign In settings**, disable public user signups. You should be able to sign in as the owner but visitors do not need accounts to listen or comment.

Security: the public website uses only the publishable/anon key. Never put a database password, service-role key, or secret key into `config.js` or any website file.

## Part 2 — test it
1. Open `index.html` locally or publish the folder as described below.
2. Open `admin.html`, sign in with the owner email/password you created, and upload a song title plus an MP3/M4A/WAV audio file. Optional cover image: JPG, PNG, or WebP.
3. Open the public page and check that the song appears and plays.
4. Try the like button and post a guest comment with a nickname.

If the browser blocks audio locally, test on the hosted HTTPS website.

## Part 3 — put it online for free with Cloudflare Pages
1. Create a free GitHub account at https://github.com/ if you don't already have one.
2. Create a new **private** or public repository named `kennyys-world`. (The website source includes only the publishable key; SQL contains your owner UUID, so keep the repo private if you prefer.)
3. Upload the files in this folder to the repository's top level. Make sure `index.html` is at the top level, not inside another folder.
4. Create a free account at https://dash.cloudflare.com/ and open **Workers & Pages**.
5. Choose **Create application → Pages → Connect to Git** and select your `kennyys-world` repository.
6. For a plain HTML site, use build command `exit 0` and output directory `/` (if Cloudflare rejects `/`, use the repository root / leave output directory as `.` according to the current UI).
7. Deploy. Cloudflare will provide an address ending in `pages.dev`. Share that public address.
8. In Supabase Authentication settings, add your public site URL to the allowed redirect/site URL settings if prompted. Password sign-in generally works without an email redirect, but set the site URL to your Pages URL.

Official references:
- Supabase JS browser setup: https://supabase.com/docs/reference/javascript/installing
- Cloudflare Pages static HTML: https://developers.cloudflare.com/pages/framework-guides/deploy-anything/

## Important limitations before launch
- Free plans have storage, bandwidth, and database limits. Audio is bandwidth-heavy; check the current provider quotas.
- The site is designed for a small initial catalog, but it is not Spotify and does not include streaming DRM.
- Likes identify a browser/device, not a verified individual; users can reset or spoof them.
- Public guest comments can be spammed. This basic starter limits text length but does not include server-side rate limiting or moderation. For a public launch, add an Edge Function or another server-side moderation/rate-limit layer.
- The browser-visible Supabase publishable/anon key is normal. Security comes from the Row Level Security (RLS) policies. The owner UUID in `schema.sql` must be replaced before running the SQL.
- Use only songs, artwork, and recordings you own or have permission to publish.

## Troubleshooting
- **"Setup required"** — check `config.js` values and reload the page.
- **Owner cannot upload** — confirm `OWNER_USER_UUID_HERE` was replaced by the exact owner UUID in all policies before running SQL, and that you are signed in as that owner.
- **Track won't play** — ensure the bucket named `music` is public-read and the audio type is allowed.
- **Comments fail** — make sure the SQL ran successfully and the `comments` insert/select policies exist.
- **Likes fail** — make sure the `likes` policies exist and the table is exposed to the Data API if your Supabase project requires it.

## Language category update

If you created your Supabase database using an earlier version of this website, open Supabase → SQL Editor and run:

```sql
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'Other';
```

New uploads let you choose a language, and visitors can filter songs by language on the home page.


## Add full and synchronized lyrics
1. Open `lyrics_migration.sql` in VS Code and copy all its contents.
2. In Supabase SQL Editor, create a new query, paste the contents, and click Run. This adds the lyrics columns to your existing tracks table.
3. Deploy the updated website files from this ZIP.
4. In Owner Studio, paste full lyrics into **Full lyrics**. For synchronized lyrics, add one row per line in `mm:ss|lyric line` format, for example `00:05|First line`. Use `hh:mm:ss|lyric line` for times over an hour.
5. Publish the song. The public song page shows the full lyrics and updates the synchronized line as playback time advances.

If the main SQL schema has not been run yet, run your completed main schema first, then run `lyrics_migration.sql` afterwards.
