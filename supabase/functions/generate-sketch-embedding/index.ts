import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { describeFace, embedText, EMBEDDING_MODEL } from '../_shared/faceEmbedding.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Always use the shared model so sketch vectors are comparable with suspect vectors.
const generateTextEmbedding = async (text: string, lovableApiKey: string) => ({
  embedding: await embedText(text, lovableApiKey),
  modelName: EMBEDDING_MODEL,
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { media_id, image_url } = await req.json();

    if (!media_id && !image_url) {
      throw new Error('Either media_id or image_url is required');
    }

    console.log('Generating sketch embedding for media_id:', media_id);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let imageUrl = image_url;
    let targetMediaId = media_id;
    let existingMeta: Record<string, unknown> = {};

    // If media_id provided, fetch the media record to get image
    if (media_id) {
      const { data: mediaData, error: mediaError } = await supabase
        .from('media')
        .select('url, type, case_id, meta')
        .eq('id', media_id)
        .single();

      if (mediaError || !mediaData) {
        console.error('Media fetch error:', mediaError);
        throw new Error('Media record not found');
      }

      console.log('Media URL from database:', mediaData.url);
      existingMeta = mediaData.meta || {};

      // Download the image from storage and convert to base64
      const { data: fileData, error: downloadError } = await supabase
        .storage
        .from('case-evidence')
        .download(mediaData.url);

      if (downloadError || !fileData) {
        console.error('Download error:', downloadError);
        throw new Error(`Failed to download image: ${downloadError?.message}`);
      }

      // Convert blob to base64 (handle large files by chunking)
      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const chunkSize = 8192;
      let binary = '';
      
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode(...chunk);
      }
      
      const base64 = btoa(binary);
      const mimeType = fileData.type || 'image/png';
      imageUrl = `data:${mimeType};base64,${base64}`;
      
      console.log('Converted image to base64 data URL');
    }

    // Step 1: Use Lovable AI vision model to generate detailed description of the image
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const visionResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Lovable-API-Key': LOVABLE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this forensic sketch or suspect photo in extreme detail. Describe all facial features, characteristics, distinctive marks, expressions, age, gender, hair, eyes, nose, mouth, face shape, skin tone, and any other identifying features. Be comprehensive and precise for forensic matching purposes.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ]
      }),
    });

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('Vision API error:', visionResponse.status, errorText);
      throw new Error('Failed to analyze image with vision model');
    }

    const visionData = await visionResponse.json();
    const imageDescription = visionData.choices?.[0]?.message?.content;

    if (!imageDescription) {
      throw new Error('No description returned from vision model');
    }

    console.log('Image description generated, length:', imageDescription.length);
    console.log('Description preview:', imageDescription.substring(0, 200));

    // Step 2: Generate 768-d embedding from the description.
    // Prefer the original Gemini text-embedding-004 vectors for compatibility with existing suspect vectors;
    // fall back to Lovable AI Gateway if Google rejects that endpoint.
    const { embedding, modelName } = await generateTextEmbedding(imageDescription, LOVABLE_API_KEY);
    console.log('Generated embedding, dimensions:', embedding.length);
    console.log('Embedding model used:', modelName);
    console.log('First 8 values:', embedding.slice(0, 8));

    const sumAbs = embedding.reduce((sum: number, val: number) => sum + Math.abs(val), 0);
    console.log('Embedding sumAbs:', sumAbs);

    // Step 3: Store embedding in media table and update ai_status
    const { data: updateData, error: updateError } = await supabase
      .from('media')
      .update({ 
        embedding,
        meta: {
          ...existingMeta,
          ai_status: 'ready_for_ai_matching',
          embedding_model: modelName,
          embedding_generated_at: new Date().toISOString()
        }
      })
      .eq('id', targetMediaId)
      .select()
      .single();

    if (updateError) {
      console.error('Database update error:', updateError);
      throw new Error('Failed to store embedding in database');
    }

    console.log('Embedding saved successfully for media_id:', targetMediaId);

    return new Response(
      JSON.stringify({
        success: true,
        media_id: targetMediaId,
        embedding_length: embedding.length,
        embedding_sample: embedding.slice(0, 8),
        description_preview: imageDescription.substring(0, 200) + '...'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error in generate-sketch-embedding function:', errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
