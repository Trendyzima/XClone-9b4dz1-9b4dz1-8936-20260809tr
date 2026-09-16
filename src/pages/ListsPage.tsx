import { useState, useEffect } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { backendCapabilities, BackendClientError } from '@/services/backendClient';
import { List, Plus, Lock, Globe, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { TopBar } from '@/components/layout/TopBar';
import { PageAdBanner } from '@/components/features/AdSenseAd';

function ListsAdBanner() { return <PageAdBanner />; }

type ListRecord = {
  id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  is_private: boolean;
  member_count?: number | null;
  created_at: string;
  updated_at: string;
};

export function ListsPage() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Lists', url: '/lists' });
  const navigate = useNavigate();
  const [lists, setLists] = useState<ListRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    void fetchLists();
  }, [user]);

  const fetchLists = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const result = await backendCapabilities.listLists();
      setLists((result.items ?? []) as ListRecord[]);
    } catch (error) {
      console.error('Error fetching lists:', error);
      toast.error(error instanceof BackendClientError ? error.message : 'Could not load lists');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Lists" showBack />
      <ListsAdBanner />
      <div className="max-w-2xl mx-auto">
        <div className="border-b border-border p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <List className="w-6 h-6" />
            <div>
              <h1 className="text-xl font-bold">Lists</h1>
              <p className="text-sm text-muted-foreground">
                {lists.length} list{lists.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button onClick={() => setShowCreateDialog(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-full hover:opacity-90">
            <Plus className="w-5 h-5" />
            New List
          </button>
        </div>

        <div>
          {lists.length === 0 ? (
            <div className="text-center py-12">
              <List className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h2 className="text-xl font-semibold mb-2">No lists yet</h2>
              <p className="text-muted-foreground mb-4">Create lists to organize people you follow</p>
              <button onClick={() => setShowCreateDialog(true)} className="px-6 py-2 bg-primary text-primary-foreground rounded-full hover:opacity-90">Create a list</button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {lists.map((list) => (
                <div key={list.id} onClick={() => navigate(`/lists/${list.id}`)} className="p-4 hover:bg-muted/50 cursor-pointer transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{list.name}</h3>
                        {list.is_private ? <Lock className="w-4 h-4 text-muted-foreground" /> : <Globe className="w-4 h-4 text-muted-foreground" />}
                      </div>
                      {list.description && <p className="text-sm text-muted-foreground mb-2">{list.description}</p>}
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Users className="w-4 h-4" />
                        <span>{list.member_count ?? 0} member{(list.member_count ?? 0) !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateDialog && <CreateListDialog onClose={() => setShowCreateDialog(false)} onCreated={() => { setShowCreateDialog(false); void fetchLists(); }} />}
    </div>
  );
}

function CreateListDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!user || !name.trim()) {
      toast.error('Please enter a list name');
      return;
    }
    setLoading(true);
    try {
      await backendCapabilities.createList(name.trim(), description.trim(), isPrivate);
      toast.success('List created successfully');
      onCreated();
    } catch (error) {
      toast.error(error instanceof BackendClientError ? error.message : 'Could not create list');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-xl max-w-md w-full">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-xl font-bold">Create List</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="List name" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background" maxLength={100} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this list about?" className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background resize-none" rows={3} maxLength={500} />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="w-5 h-5 rounded border-border" />
            <div><div className="font-medium">Make private</div><div className="text-sm text-muted-foreground">Only you can see this list</div></div>
          </label>
          <button onClick={handleCreate} disabled={loading || !name.trim()} className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
            {loading ? 'Creating...' : 'Create List'}
          </button>
        </div>
      </div>
    </div>
  );
}
