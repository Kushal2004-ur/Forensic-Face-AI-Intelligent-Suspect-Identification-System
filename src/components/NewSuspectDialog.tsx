import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  notes: z.string().optional(),
  photo_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

interface NewSuspectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuspectCreated: () => void;
}

const NewSuspectDialog = ({ open, onOpenChange, onSuspectCreated }: NewSuspectDialogProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      notes: '',
      photo_url: '',
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);
    
    try {
      const { data: suspectData, error } = await supabase
        .from('suspects')
        .insert({
          name: values.name,
          notes: values.notes || null,
          photo_url: values.photo_url || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Generate embedding for the suspect if photo URL is provided
      if (suspectData.photo_url) {
        try {
          await supabase.functions.invoke('generate-suspect-embedding', {
            body: { suspectId: suspectData.id }
          });
          console.log('Embedding generated for suspect:', suspectData.id);
        } catch (embeddingError) {
          console.error('Failed to generate embedding:', embeddingError);
          // Don't fail the whole operation, just log the error
        }
      }

      toast.success('Suspect added successfully');
      form.reset();
      onSuspectCreated();
    } catch (error) {
      console.error('Error creating suspect:', error);
      toast.error('Failed to add suspect. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Suspect</DialogTitle>
          <DialogDescription>
            Add a new suspect to the database. Include a photo URL and description for better AI matching.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Enter suspect's full name..." 
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription>
                    The suspect's full name or alias
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="photo_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Photo URL</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="https://example.com/photo.jpg" 
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription>
                    Optional: URL to suspect's photo for AI facial recognition
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description & Notes</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Physical description, criminal history, known aliases..."
                      rows={4}
                      {...field} 
                    />
                  </FormControl>
                  <FormDescription>
                    Optional: Physical description, criminal history, and other relevant information
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Adding...' : 'Add Suspect'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default NewSuspectDialog;