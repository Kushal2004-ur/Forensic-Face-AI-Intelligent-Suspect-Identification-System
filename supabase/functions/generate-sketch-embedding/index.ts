import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EMBEDDING_DIMENSIONS = 768;

type EmbeddingResult = {
  embedding: number[];
  modelName: string;
};

const validateEmbedding = (rawEmbedding: unknown, source: string): number[] => {
  if (!Array.isArray(rawEmbedding)) {
    throw new Error(`Invalid embedding returned from ${source}`);
  }

  const embedding = rawEmbedding.map((val: unknown) => {
    const num = Number(val);
    if (Number.isNaN(num)) {
      throw new Error(`Invalid embedding value from ${source}: ${val}`);
    }
    return num;
  });

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Invalid embedding dimensions from ${source}: ${embedding.length}`);
  }

  const sumAbs = embedding.reduce((sum, val) => sum + Math.abs(val), 0);
  if (sumAbs === 0) {
    throw new Error(`Generated embedding from ${source} is invalid (all zeros)`);
  }

  return embedding;
};

const generateTextEmbedding = async (text: string, lovableApiKey: string): Promise<EmbeddingResult> => {
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');

  if (geminiApiKey) {
    for (const apiVersion of ['v1', 'v1beta']) {
      console.log(`Calling Gemini embedding API with model: text-embedding-004 (${apiVersion})`);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/${apiVersion}/models/text-embedding-004:embedContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: { parts: [{ text }] },
            taskType: 'SEMANTIC_SIMILARITY',
            outputDimensionality: EMBEDDING_DIMENSIONS
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        return {
          embedding: validateEmbedding(data.embedding?.values, `Gemini text-embedding-004 ${apiVersion}`),
          modelName: `gemini-text-embedding-004-${apiVersion}`
        };
      }

      const errorText = await response.text();
      console.error(`Gemini text-embedding-004 ${apiVersion} error:`, response.status, errorText);
    }
  }

  console.log('Falling back to Lovable AI Gateway embedding model: google/gemini-embedding-001');
  const gatewayResponse = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lovableApiKey}`,
      'Lovable-API-Key': lovableApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-embedding-001',
      input: text,
      dimensions: EMBEDDING_DIMENSIONS
    }),
  });

  if (!gatewayResponse.ok) {
    const errorText = await gatewayResponse.text();
    console.error('Lovable AI Gateway embedding error:', gatewayResponse.status, errorText);
    throw new Error(`Failed to generate embedding: ${errorText}`);
  }

  const gatewayData = await gatewayResponse.json();
  return {
    embedding: validateEmbedding(gatewayData.data?.[0]?.embedding, 'Lovable AI Gateway google/gemini-embedding-001'),
    modelName: 'google/gemini-embedding-001'
  };
};

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

    // If media_id provided, fetch the media record to get image
    if (media_id) {
      const { data: mediaData, error: mediaError } = await supabase
        .from('media')
        .select('url, type, case_id')
        .eq('id', media_id)
        .single();

      if (mediaError || !mediaData) {
        console.error('Media fetch error:', mediaError);
        throw new Error('Media record not found');
      }

      console.log('Media URL from database:', mediaData.url);

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

    // Step 2: Generate 768-d embedding from the description using Gemini
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    console.log('Calling Gemini embedding API with model: text-embedding-004');
    const embeddingResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: {
            parts: [{ text: imageDescription }]
          },
          taskType: 'SEMANTIC_SIMILARITY',
          outputDimensionality: 768
        }),
      }
    );

    if (!embeddingResponse.ok) {
      const errorText = await embeddingResponse.text();
      console.error('Gemini embedding error:', embeddingResponse.status, errorText);
      throw new Error(`Failed to generate embedding: ${errorText}`);
    }

    const embeddingData = await embeddingResponse.json();
    const rawEmbedding = embeddingData.embedding?.values;

    if (!rawEmbedding || !Array.isArray(rawEmbedding)) {
      console.error('Invalid embedding structure:', embeddingData);
      throw new Error('Invalid embedding returned from API');
    }

    // Validate and convert embedding to numbers
    const embedding = rawEmbedding.map((val: any) => {
      const num = Number(val);
      if (isNaN(num)) {
        throw new Error(`Invalid embedding value: ${val}`);
      }
      return num;
    });

    console.log('Generated embedding, dimensions:', embedding.length);
    console.log('First 8 values:', embedding.slice(0, 8));

    // Validate embedding is not all zeros
    const sumAbs = embedding.reduce((sum: number, val: number) => sum + Math.abs(val), 0);
    console.log('Embedding sumAbs:', sumAbs);

    if (sumAbs === 0) {
      console.error('Embedding is all zeros! This indicates a failure.');
      throw new Error('Generated embedding is invalid (all zeros)');
    }

    if (embedding.length !== 768) {
      console.error(`Unexpected embedding length: ${embedding.length}, expected 768`);
      throw new Error(`Invalid embedding dimensions: ${embedding.length}`);
    }

    // Step 3: Store embedding in media table and update ai_status
    const { data: updateData, error: updateError } = await supabase
      .from('media')
      .update({ 
        embedding,
        meta: { ai_status: 'ready_for_ai_matching' }
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
