import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { originalDescription, questionsAndAnswers } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log('Refining description with Q&A:', { originalDescription, questionsAndAnswers });

    // Build Q&A text
    const qaText = questionsAndAnswers.map((qa: any) => 
      `Q: ${qa.question}\nA: ${qa.answer}`
    ).join('\n\n');

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
            role: 'system',
            content: `You are a forensic sketch artist assistant. Your job is to combine an initial eyewitness description with clarifying details from follow-up questions to create a comprehensive, detailed description suitable for generating a forensic sketch.

Instructions:
- Merge all the information seamlessly
- Keep the description focused on facial features
- Use clear, specific descriptive language
- Maintain a professional, detailed tone
- Return ONLY the refined description text, no extra formatting or explanation`
          },
          {
            role: 'user',
            content: `Original description: "${originalDescription}"

Clarifying details:
${qaText}

Create a comprehensive refined description that incorporates all this information.`
          }
        ],
        temperature: 0.5,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    const refinedDescription = data.choices?.[0]?.message?.content;
    
    if (!refinedDescription) {
      throw new Error('No refined description generated');
    }

    console.log('Refined description:', refinedDescription);

    return new Response(
      JSON.stringify({ refinedDescription: refinedDescription.trim() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error refining description:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
