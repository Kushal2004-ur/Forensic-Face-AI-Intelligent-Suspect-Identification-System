import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { blobToDataUrl, describeFace, embedText, EMBEDDING_MODEL } from '../_shared/faceEmbedding.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Builds a suspect's face vector with the SAME pipeline as sketches
// (vision description -> gemini-embedding-001, 768 dims) so they are comparable.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { suspectId, all } = body ?? {};
    if (!all && (!suspectId || typeof suspectId !== 'string')) return json({ success: false, error: 'suspectId or all=true is required' }, 400);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return json({ success: false, error: 'Unauthorized' }, 401);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    if (all) {
      const { data: list } = await supabase.from('suspects').select('id, name, photo_url, photo_media_id');
      const updated: string[] = [];
      const skipped: { name: string; reason: string }[] = [];
      for (const s of list ?? []) {
        try {
          await embedSuspect(supabase, s, LOVABLE_API_KEY);
          updated.push(s.name);
        } catch (e) {
          skipped.push({ name: s.name, reason: e instanceof Error ? e.message : 'error' });
        }
      }
      return json({ success: true, updated, skipped });
    }

    const { data: suspect, error: sErr } = await supabase
      .from('suspects').select('id, name, photo_url, photo_media_id').eq('id', suspectId).single();
    if (sErr || !suspect) return json({ success: false, error: 'Suspect not found' }, 404);
    await embedSuspect(supabase, suspect, LOVABLE_API_KEY);

    console.log('Suspect embedding regenerated:', suspectId, EMBEDDING_MODEL);
    return json({ success: true, suspectId, model: EMBEDDING_MODEL });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('generate-suspect-embedding error:', msg);
    return json({ success: false, error: msg }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function embedSuspect(supabase: any, suspect: { id: string; photo_url: string | null; photo_media_id: string | null }, LOVABLE_API_KEY: string) {
    const suspectId = suspect.id;

    // Resolve the suspect image: photo_media_id (storage) first, then absolute photo_url.
    let imageUrl: string | null = null;
    if (suspect.photo_media_id) {
      const { data: media } = await supabase.from('media').select('url').eq('id', suspect.photo_media_id).single();
      if (media?.url) {
        const { data: file, error: dErr } = await supabase.storage.from('case-evidence').download(media.url);
        if (dErr || !file) throw new Error(`Failed to download suspect photo: ${dErr?.message}`);
        imageUrl = await blobToDataUrl(file);
      }
    }
    if (!imageUrl && suspect.photo_url) imageUrl = suspect.photo_url;
    if (!imageUrl) throw new Error('Suspect has no photo to analyze');

    const description = await describeFace(imageUrl, LOVABLE_API_KEY);
    const vector = await embedText(description, LOVABLE_API_KEY);

    await supabase.from('suspect_embeddings').delete().eq('suspect_id', suspectId);
    const { error: insErr } = await supabase
      .from('suspect_embeddings').insert({ suspect_id: suspectId, model_name: EMBEDDING_MODEL, vector });
    if (insErr) throw new Error(`Failed to save embedding: ${insErr.message}`);
    await supabase.from('suspects').update({ photo_embedding: vector }).eq('id', suspectId);
}
