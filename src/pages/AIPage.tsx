import { useState, useEffect, useRef } from 'react';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import {
  Send, Sparkles, Bot, User, Loader2, Trash2, Copy,
  TrendingUp, Lightbulb, Code2, FileText, Zap,
  Newspaper, BarChart2, RefreshCw, PenLine
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useSEO, buildOgImageUrl } from '@/hooks/useSEO';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const QUICK_PROMPTS = [
  { icon: TrendingUp, label: 'Trending topics',  prompt: 'What are the most engaging content topics trending right now?' },
  { icon: Lightbulb,  label: 'Post ideas',       prompt: 'Give me 5 creative post ideas to grow my social media following.' },
  { icon: Code2,      label: 'Code help',        prompt: 'Help me write a simple JavaScript function to sort an array of objects.' },
  { icon: FileText,   label: 'Write caption',    prompt: 'Write an engaging caption for a stunning sunset beach photo.' },
  { icon: Zap,        label: 'Viral hook',       prompt: 'Give me 3 viral opening hooks for a post about productivity hacks.' },
];

type Tab = 'chat' | 'trends' | 'suggest';

export default function AIPage() {
  useSEO({
    title: 'Testagram AI — Your Smart Social Assistant',
    description: 'Chat with Testagram AI for content ideas, post summaries, creator tips, and real-time help. Powered by advanced language models built right into your feed.',
    url: '/ai',
    type: 'website',
    image: buildOgImageUrl({ username: 'ai' }),
    keywords: 'AI assistant, social media AI, content ideas, testagram ai, chat bot, caption generator',
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Testagram AI Assistant',
      applicationCategory: 'SocialNetworkingApplication',
      operatingSystem: 'Web',
      description: 'AI-powered assistant integrated into Testagram for generating captions, summarizing content, and answering creator questions.',
      url: 'https://testagram.site/ai',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      publisher: { '@type': 'Organization', name: 'Testagram', url: 'https://testagram.site' },
    },
  });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('chat');

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Trends state
  const [trendsContent, setTrendsContent] = useState('');
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendingTopics, setTrendingTopics] = useState<any[]>([]);

  // Suggestions state
  const [suggestContent, setSuggestContent] = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-load trends when switching to trends tab
  useEffect(() => {
    if (tab === 'trends' && !trendsContent) loadTrends();
    if (tab === 'suggest' && !suggestContent && user) loadSuggestions();
  }, [tab]);

  // ── Chat ──────────────────────────────────────────────────────────────────
  const sendMessage = async (text?: string) => {
    const userText = (text || input).trim();
    if (!userText || chatLoading) return;

    if (!user) { toast.error('Sign in to use AI'); navigate('/auth'); return; }

    const userMsg: Message = { role: 'user', content: userText, timestamp: new Date() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setChatLoading(true);

    try {
      const apiMessages = updated.map(m => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke('ai-chat', {
        body: { messages: apiMessages, stream: false },
      });

      if (error) {
        throw new Error(error.message || 'AI request failed');
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.content || 'Sorry, I could not generate a response.',
        timestamp: new Date(),
      }]);
    } catch (err: any) {
      toast.error('AI temporarily unavailable. Try again.');
      setMessages(messages);
    } finally {
      setChatLoading(false);
      inputRef.current?.focus();
    }
  };

  // ── Trends Analyzer ────────────────────────────────────────────────────────
  const loadTrends = async () => {
    setTrendsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-news-bot', {
        body: { action: 'analyze_trending', user_id: user?.id },
      });
      if (error) throw error;
      setTrendsContent(data.content || '');
      setTrendingTopics(data.topics || []);
    } catch (err: any) {
      toast.error('Could not load trends analysis');
    } finally {
      setTrendsLoading(false);
    }
  };

  // ── Content Suggestions ───────────────────────────────────────────────────
  const loadSuggestions = async () => {
    if (!user) { toast.error('Sign in to get suggestions'); return; }
    setSuggestLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-news-bot', {
        body: { action: 'suggest_content', user_id: user.id },
      });
      if (error) throw error;
      setSuggestContent(data.content || '');
    } catch (err: any) {
      toast.error('Could not load content suggestions');
    } finally {
      setSuggestLoading(false);
    }
  };

  const clearChat = () => { setMessages([]); toast.success('Chat cleared'); };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied!');
  };

  const renderMarkdown = (text: string) =>
    text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">$1</code>')
      .replace(/^#{1,3}\s(.+)$/gm, '<h3 class="font-bold text-base mt-3 mb-1">$1</h3>')
      .replace(/\n/g, '<br/>');

  return (
    <div className="flex flex-col bg-background" style={{ height: '100dvh' }}>
      <TopBar title="AI Assistant" />

      {/* Banner */}
      <div className="px-4 py-3 bg-gradient-to-r from-primary/10 to-purple-500/10 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="font-bold text-sm">Testagram AI</p>
            <p className="text-xs text-muted-foreground">Powered by Gemini 3 Flash</p>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex bg-muted/30 mx-4 my-3 rounded-xl p-1 gap-1 shrink-0">
        {([
          { id: 'chat',    label: 'Chat',       icon: Bot },
          { id: 'trends',  label: 'Trends',     icon: Newspaper },
          { id: 'suggest', label: 'Suggestions', icon: PenLine },
        ] as { id: Tab; label: string; icon: any }[]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === t.id
                ? 'bg-background shadow text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CHAT TAB ─── */}
      {tab === 'chat' && (
        <>
          <div className="flex-1 overflow-y-auto min-h-0">
            {messages.length === 0 ? (
              <div className="p-5 space-y-5">
                <div className="text-center py-2">
                  <div className="w-14 h-14 mx-auto mb-3 bg-gradient-to-br from-primary/20 to-purple-500/20 rounded-2xl flex items-center justify-center">
                    <Bot className="w-7 h-7 text-primary" />
                  </div>
                  <h2 className="text-lg font-bold mb-1">How can I help?</h2>
                  <p className="text-sm text-muted-foreground">Ask me anything — content, code, writing, research.</p>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {QUICK_PROMPTS.map((qp, i) => (
                    <button key={i} onClick={() => sendMessage(qp.prompt)}
                      className="flex items-center gap-3 p-3 bg-muted/40 hover:bg-muted/70 rounded-xl text-left transition-colors group">
                      <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                        <qp.icon className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium">{qp.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-4">
                {messages.length > 0 && (
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={clearChat} className="gap-1 text-xs">
                      <Trash2 className="w-3.5 h-3.5" /> Clear
                    </Button>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center shrink-0 mt-1">
                        <Sparkles className="w-4 h-4 text-white" />
                      </div>
                    )}
                    <div className={`max-w-[85%] group relative ${msg.role === 'user' ? 'order-first' : ''}`}>
                      <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-muted rounded-bl-sm'
                      }`}>
                        {msg.role === 'assistant' ? (
                          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                        ) : (
                          <p>{msg.content}</p>
                        )}
                      </div>
                      {msg.role === 'assistant' && (
                        <button onClick={() => copyText(msg.content)}
                          className="absolute -top-2 -right-2 w-6 h-6 bg-background border border-border rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                          <Copy className="w-3 h-3" />
                        </button>
                      )}
                      <p className="text-xs text-muted-foreground mt-1 px-1">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {msg.role === 'user' && (
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4 text-white animate-pulse" />
                    </div>
                    <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                      <div className="flex gap-1 items-center h-5">
                        {[0, 150, 300].map(d => (
                          <div key={d} className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce"
                            style={{ animationDelay: `${d}ms` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Chat input */}
          <div className="shrink-0 border-t border-border bg-background px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
            <div className="flex items-end gap-2 bg-muted rounded-2xl px-4 py-2">
              <textarea ref={inputRef} rows={1} placeholder="Ask me anything…"
                value={input}
                onChange={e => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                className="flex-1 bg-transparent outline-none text-sm py-1.5 resize-none min-h-[36px] max-h-[120px] leading-relaxed"
              />
              <button onClick={() => sendMessage()} disabled={!input.trim() || chatLoading}
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40 transition-opacity hover:opacity-90 mb-0.5">
                {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-center text-muted-foreground mt-1.5">AI can make mistakes — verify important info</p>
          </div>
        </>
      )}

      {/* ── TRENDS TAB ─── */}
      {tab === 'trends' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-primary" />
              Trend Analysis
            </h2>
            <Button variant="outline" size="sm" onClick={loadTrends} disabled={trendsLoading} className="gap-1">
              <RefreshCw className={`w-3.5 h-3.5 ${trendsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          {/* Trending topics chips */}
          {trendingTopics.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Trending Now</p>
              <div className="flex flex-wrap gap-2">
                {trendingTopics.slice(0, 8).map((t, i) => (
                  <span key={i} className="px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-semibold">
                    #{t.topic}
                  </span>
                ))}
              </div>
            </div>
          )}

          {trendsLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Analyzing platform trends…</p>
            </div>
          ) : trendsContent ? (
            <div className="bg-muted/30 border border-border rounded-2xl p-4">
              <div
                className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(trendsContent) }}
              />
              <div className="flex gap-2 mt-4">
                <Button size="sm" variant="outline" onClick={() => copyText(trendsContent)} className="gap-1">
                  <Copy className="w-3.5 h-3.5" /> Copy
                </Button>
                <Button size="sm" variant="outline" onClick={loadTrends} className="gap-1">
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <Newspaper className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-muted-foreground text-sm">Click Refresh to analyze current trends</p>
            </div>
          )}
        </div>
      )}

      {/* ── SUGGESTIONS TAB ─── */}
      {tab === 'suggest' && (
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <PenLine className="w-5 h-5 text-primary" />
              Content Suggestions
            </h2>
            <Button variant="outline" size="sm" onClick={loadSuggestions} disabled={suggestLoading} className="gap-1">
              <RefreshCw className={`w-3.5 h-3.5 ${suggestLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>

          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-sm text-muted-foreground">
            <Lightbulb className="w-4 h-4 text-primary inline mr-1.5" />
            AI analyzes your post history and current trends to suggest personalized content ideas.
          </div>

          {suggestLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Generating personalized suggestions…</p>
            </div>
          ) : suggestContent ? (
            <div className="bg-muted/30 border border-border rounded-2xl p-4">
              <div
                className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(suggestContent) }}
              />
              <div className="flex gap-2 mt-4">
                <Button size="sm" variant="outline" onClick={() => copyText(suggestContent)} className="gap-1">
                  <Copy className="w-3.5 h-3.5" /> Copy All
                </Button>
                <Button size="sm" onClick={loadSuggestions} className="gap-1">
                  <RefreshCw className="w-3.5 h-3.5" /> New Ideas
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <PenLine className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-muted-foreground text-sm mb-4">
                {user ? 'Get AI-powered post ideas tailored to your style' : 'Sign in to get personalized suggestions'}
              </p>
              {user ? (
                <Button onClick={loadSuggestions}>Generate Ideas</Button>
              ) : (
                <Button onClick={() => navigate('/auth')}>Sign In</Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
