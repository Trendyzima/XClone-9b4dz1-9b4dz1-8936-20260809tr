import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { backendCapabilities, BackendClientError } from '@/services/backendClient';
import { PostCard } from '@/components/features/PostCard';
import { Users, Plus, Trash2, Lock, Globe, Search, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { PageAdBanner } from '@/components/features/AdSenseAd';

function ListDetailAdBanner() { return <PageAdBanner />; }

type ListRecord = { id: string; owner_id: string; name: string; description?: string | null; is_private: boolean; member_count?: number | null; };
type MemberProfile = { id: string; username: string; display_name?: string | null; avatar_url?: string | null; bio?: string | null; };

export default function ListDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState<ListRecord | null>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Posts');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const listJsonLd = useMemo(() => {
    if (!list) return undefined;
    return { '@context': 'https://schema.org', '@type': 'ItemList', name: list.name, description: list.description ?? `A curated list by @${user?.email?.split('@')[0] ?? 'creator'} on Testagram`, url: `https://testagram.site/lists/${id}`, numberOfItems: members.length, itemListElement: members.slice(0, 10).map((m, i) => ({ '@type': 'ListItem', position: i + 1, name: m.username, url: `https://testagram.site/profile/${m.username}` })) };
  }, [list, members, id, user]);

  useSEO({ title: list ? `${list.name} — List on Testagram` : 'List', description: list ? `${list.name}: ${members.length} member${members.length !== 1 ? 's' : ''}${list.description ? '. ' + list.description : ''}. Curated on Testagram.` : 'A curated list on Testagram.', url: `/lists/${id}`, noindex: list?.is_private ?? true, structuredData: listJsonLd });

  useEffect(() => { if (!id) return; void Promise.all([fetchList(), fetchMembers(), fetchPosts()]); }, [id]);

  const fetchList = async () => {
    try {
      const { data, error } = await supabase.from('lists').select('id,owner_id,name,description,is_private,member_count').eq('id', id).single();
      if (error) throw error;
      if (data.is_private && data.owner_id !== user?.id) { toast.error('This list is private'); navigate('/lists'); return; }
      setList(data as ListRecord);
    } catch (error) { console.error('Error fetching list:', error); navigate('/lists'); } finally { setLoading(false); }
  };

  const fetchMembers = async () => {
    if (!id) return;
    const { data, error } = await supabase.from('list_members').select('user_id, profiles (*)').eq('list_id', id).order('added_at', { ascending: false });
    if (error) { console.error('Error fetching list members:', error); setMembers([]); return; }
    setMembers((data ?? []).map((m: any) => m.user_profiles).filter(Boolean));
  };

  const fetchPosts = async () => {
    if (!id) return;
    try { const result = await backendCapabilities.getListTimeline(id, 50); setPosts((result.items ?? []) as any[]); }
    catch (error) { console.error('Error fetching list timeline:', error); setPosts([]); }
  };

  const searchUsers = async (query: string) => {
    if (!query.trim()) { setSearchResults([]); return; }
    try {
      const result = await backendCapabilities.searchUsers(query.trim(), 20);
      const memberIds = new Set(members.map((member) => member.id));
      setSearchResults((result.items ?? []).filter((profile: any) => !memberIds.has(profile.id)));
    } catch (error) { console.error('Error searching users for list:', error); setSearchResults([]); }
  };

  const addMember = async (userId: string) => {
    if (!id) return;
    try { await backendCapabilities.addListMember(id, userId); toast.success('User added to list'); await Promise.all([fetchMembers(), fetchPosts()]); setShowAddDialog(false); setSearchQuery(''); setSearchResults([]); }
    catch (error) { toast.error(error instanceof BackendClientError ? error.message : 'Could not add user'); }
  };

  const removeMember = async (userId: string) => {
    if (!id || !confirm('Remove this user from the list?')) return;
    try { await backendCapabilities.removeListMember(id, userId); toast.success('User removed from list'); await Promise.all([fetchMembers(), fetchPosts()]); }
    catch (error) { toast.error(error instanceof BackendClientError ? error.message : 'Could not remove user'); }
  };

  const deleteList = async () => {
    if (!id || !confirm('Delete this list? This action cannot be undone.')) return;
    try { const { error } = await supabase.from('lists').delete().eq('id', id).eq('owner_id', user?.id ?? ''); if (error) throw error; toast.success('List deleted'); navigate('/lists'); }
    catch (error: any) { toast.error(error.message ?? 'Could not delete list'); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!list) return null;
  const isOwner = user?.id === list.owner_id;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title={list.name} showBack />
      <ListDetailAdBanner />
      <div className="border-b border-border p-6">
        <div className="flex items-start justify-between mb-4"><div className="flex-1"><div className="flex items-center gap-2 mb-2"><h1 className="text-2xl font-bold">{list.name}</h1>{list.is_private ? <Lock className="w-5 h-5 text-muted-foreground" /> : <Globe className="w-5 h-5 text-muted-foreground" />}</div>{list.description && <p className="text-muted-foreground mb-3">{list.description}</p>}<div className="flex items-center gap-4 text-sm text-muted-foreground"><div className="flex items-center gap-1"><Users className="w-4 h-4" /><span>{list.member_count ?? members.length} members</span></div></div></div>{isOwner && <div className="flex gap-2"><Button onClick={() => setShowAddDialog(true)} size="sm" className="rounded-full"><Plus className="w-4 h-4 mr-2" />Add</Button><Button onClick={deleteList} size="sm" variant="destructive" className="rounded-full"><Trash2 className="w-4 h-4" /></Button></div>}</div>
      </div>
      <div className="sticky top-14 z-30 bg-background border-b border-border"><div className="flex"><button onClick={() => setActiveTab('Posts')} className={`flex-1 py-4 font-semibold transition-colors border-b-2 ${activeTab === 'Posts' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/50'}`}>Posts</button><button onClick={() => setActiveTab('Members')} className={`flex-1 py-4 font-semibold transition-colors border-b-2 ${activeTab === 'Members' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/50'}`}>Members ({members.length})</button></div></div>
      {activeTab === 'Posts' ? (posts.length > 0 ? posts.map((post) => <PostCard key={post.id} post={post} onUpdate={fetchPosts} />) : <div className="text-center py-12 text-muted-foreground"><p>No posts yet</p><p className="text-sm mt-2">Add members to see their posts here</p></div>) : (<div className="divide-y divide-border">{members.map((member) => <div key={member.id} className="p-4 flex items-center justify-between"><div onClick={() => navigate(`/profile/${member.username}`)} className="flex items-center gap-3 flex-1 cursor-pointer"><div className="w-12 h-12 rounded-full bg-muted overflow-hidden">{member.avatar_url ? <img src={member.avatar_url} alt={member.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold">{member.username[0].toUpperCase()}</div>}</div><div><p className="font-semibold">{member.username}</p><p className="text-sm text-muted-foreground">@{member.username}</p></div></div>{isOwner && <Button onClick={() => removeMember(member.id)} size="sm" variant="outline">Remove</Button>}</div>)}</div>)}
      {showAddDialog && <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-background rounded-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col"><div className="p-4 border-b border-border flex items-center justify-between"><h2 className="text-xl font-bold">Add to List</h2><button onClick={() => setShowAddDialog(false)} className="p-2 hover:bg-muted rounded-full"><X className="w-5 h-5" /></button></div><div className="p-4 border-b border-border"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" /><Input value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); void searchUsers(e.target.value); }} placeholder="Search users..." className="pl-10" /></div></div><div className="flex-1 overflow-y-auto">{searchResults.map((result) => <div key={result.id} className="p-4 hover:bg-muted/50 flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-muted overflow-hidden">{result.avatar_url ? <img src={result.avatar_url} alt={result.username} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-bold">{result.username[0].toUpperCase()}</div>}</div><div><p className="font-semibold">{result.username}</p><p className="text-sm text-muted-foreground">@{result.username}</p></div></div><Button onClick={() => addMember(result.id)} size="sm">Add</Button></div>)}</div></div></div>}
    </div>
  );
}
