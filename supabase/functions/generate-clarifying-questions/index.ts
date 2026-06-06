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
    const { description } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log('Generating clarifying questions for description:', description);

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
            content: `You are a forensic sketch artist assistant. Your job is to generate 3-5 specific clarifying questions about a suspect's facial features based on an initial eyewitness description. 
            
Focus on different facial features that weren't fully described:
- Eye shape, color, and characteristics
- Eyebrow shape and thickness
- Nose shape and size
- Lip fullness and shape
- Face shape (oval, round, square, heart-shaped, etc.)
- Distinctive marks (scars, moles, birthmarks)
- Hair texture and style details
- Facial hair if applicable

Return ONLY a JSON array of question objects with this format:
[
  {
    "question": "What was the shape of the suspect's eyes?",
    "category": "eyes",
    "options": ["Almond-shaped", "Round", "Hooded", "Deep-set", "Wide-set"]
  }
]

Each question should have 4-5 specific options. Make questions clear and specific.`
          },
          {
            role: 'user',
            content: `Generate 3-5 clarifying questions for this eyewitness description: "${description}"`
          }
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI error:', response.status, errorText);
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    const questionsText = data.choices?.[0]?.message?.content;
    
    if (!questionsText) {
      throw new Error('No questions generated');
    }

    console.log('AI response:', questionsText);

    // Parse the JSON array from the response
    let questions;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = questionsText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || 
                       questionsText.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : questionsText;
      questions = JSON.parse(jsonStr.trim());
    } catch (e) {
      console.error('Failed to parse questions JSON:', e);
      throw new Error('Failed to parse AI response as JSON');
    }

    console.log('Parsed questions:', questions);

    return new Response(
      JSON.stringify({ questions }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating questions:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
