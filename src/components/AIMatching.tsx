import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Loader2, Search, Users, Brain, Target, GitCompare, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ComparisonModal } from './ComparisonModal';

interface AIMatchingProps {
  caseId: string;
}

interface SketchMatch {
  suspect_id: string;
  suspect_name: string;
  suspect_photo_url: string | null;
  suspect_photo_media_id: string | null;
  similarity_score: number;
}

const AIMatching = ({ caseId }: AIMatchingProps) => {
  const [isSearching, setIsSearching] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [matches, setMatches] = useState<SketchMatch[]>([]);
  const [threshold, setThreshold] = useState([0.7]);
  const [selectedSketch, setSelectedSketch] = useState<string | null>(null);
  const [comparisonMatch, setComparisonMatch] = useState<{
    sketchUrl: string;
    sketchId: string;
    sketchDate: string;
    match: SketchMatch;
  } | null>(null);
  const { toast } = useToast();

  // Fetch available sketches for this case
  const { data: sketches, isLoading: sketchesLoading, refetch } = useQuery({
    queryKey: ['case-sketches', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('media')
        .select('id, url, meta, created_at, embedding')
        .eq('case_id', caseId)
        .eq('type', 'sketch')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    // Smart polling: only poll if there are sketches without ready status
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasGeneratingSketches = data?.some(sketch => {
        const aiStatus = sketch.meta && typeof sketch.meta === 'object' ? (sketch.meta as any).ai_status : null;
        return aiStatus !== 'ready_for_ai_matching' && sketch.meta && typeof sketch.meta === 'object' && 'generatedAt' in sketch.meta;
      });
      // Poll every 3 seconds if there are generating sketches, otherwise stop polling
      return hasGeneratingSketches ? 3000 : false;
    },
  });

  const runAIMatching = async (sketchId: string) => {
    setIsSearching(true);
    setMatches([]);
    
    try {
      const { data, error } = await supabase.functions.invoke('find-suspect-matches', {
        body: {
          caseId,
          sketchId,
          threshold: threshold[0]
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data.success) {
        setMatches(data.matches || []);
        toast({
          title: "AI Matching Complete",
          description: `Found ${data.total_matches} potential matches (${data.high_confidence_matches} high confidence)`,
        });
      } else {
        throw new Error(data.error || 'Failed to find matches');
      }
    } catch (error) {
      console.error('Error running AI matching:', error);
      toast({
        title: "Matching Failed",
        description: error instanceof Error ? error.message : "Failed to find suspect matches. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const rebuildSuspectFingerprints = async () => {
    setIsRebuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-suspect-embedding', { body: { all: true } });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Rebuild failed');
      const skipped = (data.skipped || []).map((s: { name: string }) => s.name);
      toast({
        title: 'Suspect database refreshed',
        description: `Updated ${data.updated?.length || 0} suspects.` + (skipped.length ? ` Skipped (no photo): ${skipped.join(', ')}` : ''),
      });
    } catch (error) {
      toast({
        title: 'Refresh failed',
        description: error instanceof Error ? error.message : 'Could not refresh suspect database',
        variant: 'destructive',
      });
    } finally {
      setIsRebuilding(false);
    }
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.9) return 'bg-red-500';
    if (score >= 0.8) return 'bg-orange-500';
    if (score >= 0.7) return 'bg-yellow-500';
    return 'bg-gray-500';
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 0.9) return 'Very High';
    if (score >= 0.8) return 'High';
    if (score >= 0.7) return 'Medium';
    return 'Low';
  };

  return (
    <div className="space-y-6">
      {/* AI Matching Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Suspect Matching
          </CardTitle>
          <CardDescription>
            Use facial similarity analysis to find potential suspects matching generated sketches
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Sketch Selection */}
          <div className="space-y-2">
            <Label>Available Sketches</Label>
            {sketchesLoading ? (
              <p className="text-muted-foreground">Loading sketches...</p>
            ) : sketches && sketches.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sketches.map((sketch) => (
                  <div 
                    key={sketch.id} 
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${
                      selectedSketch === sketch.id ? 'ring-2 ring-primary' : 'hover:shadow-md'
                    }`}
                    onClick={() => setSelectedSketch(sketch.id)}
                  >
                    <div className="flex items-center space-x-3">
                      <img 
                        src={sketch.url} 
                        alt="Generated sketch"
                        className="h-16 w-16 rounded object-cover"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          Generated Sketch
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(sketch.created_at).toLocaleDateString()}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {(() => {
                            const aiStatus = sketch.meta && typeof sketch.meta === 'object' ? (sketch.meta as any).ai_status : null;
                            const isReady = aiStatus === 'ready_for_ai_matching';
                            const isGenerating = !isReady && sketch.meta && typeof sketch.meta === 'object' && 'generatedAt' in sketch.meta;
                            
                            return (
                              <Badge 
                                variant={isReady ? 'default' : 'secondary'} 
                                className="text-xs"
                              >
                                {isReady
                                  ? '✅ Ready for AI Suspect Match' 
                                  : isGenerating
                                    ? '⏳ Generating embedding...'
                                    : 'No embedding'
                                }
                              </Badge>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No sketches available. Generate a sketch first to enable AI matching.</p>
            )}
          </div>

          {/* Similarity Threshold */}
          <div className="space-y-2">
            <Label>Similarity Threshold: {Math.round(threshold[0] * 100)}%</Label>
            <Slider
              value={threshold}
              onValueChange={setThreshold}
              max={1}
              min={0.5}
              step={0.05}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher values return fewer but more confident matches
            </p>
          </div>

          {/* Search Button */}
          <Button 
            onClick={() => selectedSketch && runAIMatching(selectedSketch)}
            disabled={isSearching || !selectedSketch || (() => {
              const sketch = sketches?.find(s => s.id === selectedSketch);
              if (!sketch) return true;
              const aiStatus = sketch.meta && typeof sketch.meta === 'object' ? (sketch.meta as any).ai_status : null;
              return aiStatus !== 'ready_for_ai_matching';
            })()}
            className="w-full"
          >
            {isSearching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing Facial Features...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Run AI Suspect Matching
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={rebuildSuspectFingerprints}
            disabled={isRebuilding}
            className="w-full"
          >
            {isRebuilding ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {isRebuilding ? 'Refreshing suspect database...' : 'Refresh Suspect Database'}
          </Button>
        </CardContent>
      </Card>

      {/* Matching Results */}
      {matches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Potential Matches ({matches.length})
            </CardTitle>
            <CardDescription>
              Suspects ranked by facial similarity confidence
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {matches.map((match, index) => {
                const currentSketch = sketches?.find(s => s.id === selectedSketch);
                return (
                  <div key={match.suspect_id} className="border rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="relative">
                        {match.suspect_photo_url ? (
                          <img 
                            src={match.suspect_photo_url} 
                            alt={match.suspect_name}
                            className="h-16 w-16 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                            <Users className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        <div className="absolute -top-1 -right-1 text-xs font-bold text-white bg-primary rounded-full w-5 h-5 flex items-center justify-center">
                          {index + 1}
                        </div>
                      </div>
                      <div>
                        <p className="font-medium">{match.suspect_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {Math.round(match.similarity_score * 100)}% facial similarity
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`${getConfidenceColor(match.similarity_score)} text-white`}>
                        {getConfidenceLabel(match.similarity_score)} Confidence
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (currentSketch) {
                            setComparisonMatch({
                              sketchUrl: currentSketch.url,
                              sketchId: currentSketch.id,
                              sketchDate: currentSketch.created_at,
                              match,
                            });
                          }
                        }}
                      >
                        <GitCompare className="h-4 w-4 mr-2" />
                        Compare
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {isSearching && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center space-y-2">
              <Loader2 className="h-8 w-8 animate-spin mx-auto" />
              <p className="text-muted-foreground">
                Analyzing facial features and comparing against suspect database...
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Comparison Modal */}
      {comparisonMatch && (
        <ComparisonModal
          isOpen={!!comparisonMatch}
          onClose={() => setComparisonMatch(null)}
          sketchUrl={comparisonMatch.sketchUrl}
          sketchId={comparisonMatch.sketchId}
          sketchDate={comparisonMatch.sketchDate}
          suspectPhotoUrl={comparisonMatch.match.suspect_photo_url || undefined}
          suspectPhotoMediaId={comparisonMatch.match.suspect_photo_media_id || undefined}
          suspectId={comparisonMatch.match.suspect_id}
          suspectName={comparisonMatch.match.suspect_name}
          similarityScore={comparisonMatch.match.similarity_score}
          modelName="text-embedding-004"
          caseId={caseId}
        />
      )}
    </div>
  );
};

export default AIMatching;