-- Kennyy's World lyrics feature migration
-- Run this in Supabase SQL Editor AFTER your main schema.sql succeeded.
-- Safe to run more than once.
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS lyrics text NOT NULL DEFAULT '';
ALTER TABLE public.tracks ADD COLUMN IF NOT EXISTS synced_lyrics jsonb NOT NULL DEFAULT '[]'::jsonb;
