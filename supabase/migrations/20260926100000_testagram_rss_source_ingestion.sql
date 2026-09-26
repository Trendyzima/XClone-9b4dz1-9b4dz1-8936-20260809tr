create extension if not exists pgcrypto;

create table if not exists public.testagram_rss_source_profiles (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  handle text not null unique,
  display_name text not null,
  category text not null,
  country_code text,
  avatar_url text,
  profile_url text,
  bio text,
  is_system_source boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.testagram_rss_sources (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.testagram_rss_source_profiles(id) on delete cascade,
  source_name text not null,
  feed_url text not null unique,
  category text not null,
  country_code text,
  language_code text not null default 'en',
  enabled boolean not null default true,
  refresh_minutes integer not null default 60,
  last_fetched_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  next_fetch_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.testagram_rss_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.testagram_rss_sources(id) on delete cascade,
  profile_id uuid not null references public.testagram_rss_source_profiles(id) on delete cascade,
  guid text,
  canonical_url text not null,
  title text not null,
  excerpt text,
  author text,
  image_url text,
  category text not null,
  country_code text,
  language_code text not null default 'en',
  published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  metadata jsonb not null default '{}'::jsonb,
  unique(source_id, canonical_url)
);

create index if not exists testagram_rss_items_published_idx on public.testagram_rss_items(published_at desc);
create index if not exists testagram_rss_items_expiry_idx on public.testagram_rss_items(expires_at);
create index if not exists testagram_rss_items_category_idx on public.testagram_rss_items(category, published_at desc);
create index if not exists testagram_rss_sources_due_idx on public.testagram_rss_sources(next_fetch_at) where enabled;

alter table public.testagram_rss_source_profiles enable row level security;
alter table public.testagram_rss_sources enable row level security;
alter table public.testagram_rss_items enable row level security;
revoke all on public.testagram_rss_source_profiles, public.testagram_rss_sources, public.testagram_rss_items from anon, authenticated;

create or replace function public.cleanup_testagram_rss_items()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare n integer;
begin
 delete from public.testagram_rss_items
 where expires_at <= now() or published_at < now() - interval '12 hours';
 get diagnostics n = row_count;
 return n;
end $$;
revoke all on function public.cleanup_testagram_rss_items() from public;

insert into public.testagram_rss_source_profiles(source_name,handle,display_name,category,country_code,bio)
values
('BBC World','bbcworld','BBC World','news','GB','BBC World news'),
('BBC UK','bbcuk','BBC UK','news','GB','BBC UK news'),
('BBC Business','bbcbusiness','BBC Business','business','GB','BBC Business'),
('BBC Politics','bbcpolitics','BBC Politics','politics','GB','BBC Politics'),
('BBC Health','bbchealth','BBC Health','health','GB','BBC Health'),
('BBC Science & Environment','bbcscience','BBC Science & Environment','science','GB','BBC Science and Environment'),
('BBC Technology','bbctech','BBC Technology','technology','GB','BBC Technology'),
('BBC Entertainment & Arts','bbcentertainment','BBC Entertainment & Arts','entertainment','GB','BBC Entertainment and Arts'),
('BBC Sport','bbcsport','BBC Sport','sports','GB','BBC Sport'),
('BBC Africa','bbcafrica','BBC Africa','africa','GB','BBC Africa'),
('The Guardian World','guardianworld','The Guardian World','news','GB','The Guardian World'),
('The Guardian UK','guardianuk','The Guardian UK','news','GB','The Guardian UK'),
('The Guardian US','guardianus','The Guardian US','news','US','The Guardian US'),
('The Guardian Africa','guardianafrica','The Guardian Africa','africa','GB','The Guardian Africa'),
('The Guardian International','guardianinternational','The Guardian International','news','GB','The Guardian International'),
('The Guardian Breaking/News','guardiannews','The Guardian News','breaking','GB','The Guardian News'),
('Al Jazeera','aljazeera','Al Jazeera','news','QA','Al Jazeera'),
('France 24','france24','France 24','news','FR','France 24'),
('DW World','dwworld','DW World','news','DE','DW World'),
('Euronews','euronews','Euronews','news','EU','Euronews'),
('ABC News Top Stories','abctop','ABC News','news','US','ABC News Top Stories'),
('ABC News U.S.','abcus','ABC News U.S.','news','US','ABC News U.S.'),
('ABC News International','abcinternational','ABC News International','news','US','ABC News International'),
('ABC News Politics','abcpolitics','ABC News Politics','politics','US','ABC News Politics'),
('ABC News Business','abcbusiness','ABC News Business','business','US','ABC News Business'),
('ABC News Technology','abctech','ABC News Technology','technology','US','ABC News Technology'),
('ABC News Health','abchealth','ABC News Health','health','US','ABC News Health'),
('ABC News Entertainment','abcentertainment','ABC News Entertainment','entertainment','US','ABC News Entertainment'),
('ABC News Travel','abctravel','ABC News Travel','travel','US','ABC News Travel'),
('ABC News World','abcworld','ABC News World','world','US','ABC News World'),
('FOX News Latest','foxnews','FOX News','news','US','FOX News Latest'),
('FOX News World','foxworld','FOX News World','world','US','FOX News World'),
('FOX News U.S.','foxus','FOX News U.S.','news','US','FOX News U.S.'),
('FOX News Politics','foxpolitics','FOX News Politics','politics','US','FOX News Politics'),
('FOX News Science','foxscience','FOX News Science','science','US','FOX News Science'),
('FOX News Health','foxhealth','FOX News Health','health','US','FOX News Health'),
('FOX News Sports','foxsports','FOX News Sports','sports','US','FOX News Sports'),
('FOX News Technology','foxtech','FOX News Technology','technology','US','FOX News Technology'),
('FOX News Travel','foxtravel','FOX News Travel','travel','US','FOX News Travel'),
('FOX News Video','foxvideo','FOX News Video','video','US','FOX News Video'),
('The Standard Headlines','standardheadlines','The Standard','news','KE','The Standard Kenya headlines'),
('The Standard Kenya','standardke','The Standard Kenya','kenya','KE','The Standard Kenya'),
('The Standard World','standardworld','The Standard World','world','KE','The Standard World'),
('The Standard Politics','standardpolitics','The Standard Politics','politics','KE','The Standard Politics'),
('The Standard Opinion','standardopinion','The Standard Opinion','opinion','KE','The Standard Opinion'),
('The Standard Sports','standardsports','The Standard Sports','sports','KE','The Standard Sports'),
('The Standard Business','standardbusiness','The Standard Business','business','KE','The Standard Business'),
('The Standard Agriculture','standardagri','The Standard Agriculture','agriculture','KE','The Standard Agriculture'),
('The Standard KTN Videos','standardktn','The Standard KTN Videos','video','KE','The Standard KTN Videos'),
('The Standard Entertainment','standardent','The Standard Entertainment','entertainment','KE','The Standard Entertainment'),
('Nation Africa','nationafrica','Nation Africa','kenya','KE','Nation Africa'),
('Citizen Digital','citizendigital','Citizen Digital','kenya','KE','Citizen Digital'),
('Capital FM Kenya','capitalfm','Capital FM Kenya','kenya','KE','Capital FM Kenya'),
('KBC','kbc','KBC','kenya','KE','Kenya Broadcasting Corporation'),
('Tuko News','tuko','Tuko News','kenya','KE','Tuko News'),
('Mpasho','mpasho','Mpasho','entertainment','KE','Mpasho entertainment'),
('The Star Kenya','thestar','The Star Kenya','kenya','KE','The Star Kenya'),
('Business Daily Africa','businessdailyafrica','Business Daily Africa','business','KE','Business Daily Africa'),
('Techweez','techweez','Techweez','technology','KE','Techweez'),
('CIO East Africa','cioafrica','CIO East Africa','technology','KE','CIO East Africa'),
('Billboard','billboard','Billboard','music','US','Billboard'),
('Billboard Music','billboardmusic','Billboard Music','music','US','Billboard Music'),
('Rolling Stone','rollingstone','Rolling Stone','music','US','Rolling Stone'),
('Rolling Stone Music','rollingstonemusic','Rolling Stone Music','music','US','Rolling Stone Music'),
('Pitchfork News','pitchfork','Pitchfork','music','US','Pitchfork News'),
('NPR Music','nprmusic','NPR Music','music','US','NPR Music'),
('Music Business Worldwide','mbw','Music Business Worldwide','music','GB','Music Business Worldwide'),
('EDM.com','edmcom','EDM.com','music','US','EDM.com'),
('Metal Injection','metalinjection','Metal Injection','music','US','Metal Injection'),
('Song Exploder','songexploder','Song Exploder','music','US','Song Exploder'),
('Your EDM','youredm','Your EDM','music','US','Your EDM'),
('Consequence','consequence','Consequence','music','US','Consequence'),
('Stereogum','stereogum','Stereogum','music','US','Stereogum'),
('BrooklynVegan','brooklynvegan','BrooklynVegan','music','US','BrooklynVegan'),
('The FADER','thefader','The FADER','music','US','The FADER'),
('Variety','variety','Variety','entertainment','US','Variety'),
('Deadline','deadline','Deadline','entertainment','US','Deadline'),
('The Hollywood Reporter','hollywoodreporter','The Hollywood Reporter','entertainment','US','The Hollywood Reporter'),
('TheWrap','thewrap','TheWrap','entertainment','US','TheWrap'),
('IGN','ign','IGN','gaming','US','IGN'),
('GameSpot','gamespot','GameSpot','gaming','US','GameSpot'),
('PC Gamer','pcgamer','PC Gamer','gaming','US','PC Gamer'),
('Polygon','polygon','Polygon','gaming','US','Polygon'),
('Kotaku','kotaku','Kotaku','gaming','US','Kotaku'),
('NPR Pop Culture','nprpop','NPR Pop Culture','culture','US','NPR Pop Culture'),
('Guardian Culture','guardianculture','Guardian Culture','culture','GB','Guardian Culture'),
('BBC Entertainment & Arts 2','bbcentertainment2','BBC Entertainment & Arts','entertainment','GB','BBC Entertainment and Arts'),
('Rolling Stone TV & Movies','rollingstonetv','Rolling Stone TV & Movies','entertainment','US','Rolling Stone TV and Movies'),
('Rolling Stone Culture','rollingstoneculture','Rolling Stone Culture','culture','US','Rolling Stone Culture'),
('E! News','enews','E! News','entertainment','US','E! News'),
('WIRED Top Stories','wired','WIRED','technology','US','WIRED Top Stories'),
('WIRED Business','wiredbusiness','WIRED Business','business','US','WIRED Business'),
('WIRED AI','wiredai','WIRED AI','ai','US','WIRED AI'),
('WIRED Science','wiredscience','WIRED Science','science','US','WIRED Science'),
('WIRED Security','wiredsecurity','WIRED Security','security','US','WIRED Security'),
('TechCrunch','techcrunch','TechCrunch','technology','US','TechCrunch'),
('Ars Technica','arstechnica','Ars Technica','technology','US','Ars Technica'),
('The Verge','theverge','The Verge','technology','US','The Verge'),
('Space.com','spacecom','Space.com','science','US','Space.com'),
('Popular Science','popsci','Popular Science','science','US','Popular Science')
on conflict(handle) do update set display_name=excluded.display_name,category=excluded.category,country_code=excluded.country_code,bio=excluded.bio,updated_at=now();

insert into public.testagram_rss_sources(profile_id,source_name,feed_url,category,country_code)
select p.id,p.source_name,v.feed_url,p.category,p.country_code
from (values
('bbcworld','https://feeds.bbci.co.uk/news/world/rss.xml'),('bbcuk','https://feeds.bbci.co.uk/news/uk/rss.xml'),('bbcbusiness','https://feeds.bbci.co.uk/news/business/rss.xml'),('bbcpolitics','https://feeds.bbci.co.uk/news/politics/rss.xml'),('bbchealth','https://feeds.bbci.co.uk/news/health/rss.xml'),('bbcscience','https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'),('bbctech','https://feeds.bbci.co.uk/news/technology/rss.xml'),('bbcentertainment','https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'),('bbcsport','https://feeds.bbci.co.uk/sport/rss.xml'),('bbcafrica','https://feeds.bbci.co.uk/news/world/africa/rss.xml'),
('guardianworld','https://www.theguardian.com/world/rss'),('guardianuk','https://www.theguardian.com/uk/rss'),('guardianus','https://www.theguardian.com/us-news/rss'),('guardianafrica','https://www.theguardian.com/world/africa/rss'),('guardianinternational','https://www.theguardian.com/international/rss'),('guardiannews','https://www.theguardian.com/news/rss'),('aljazeera','https://www.aljazeera.com/xml/rss/all.xml'),('france24','https://www.france24.com/en/rss'),('dwworld','https://rss.dw.com/rdf/rss-en-all'),('euronews','https://www.euronews.com/rss'),
('abctop','https://abcnews.go.com/abcnews/topstories'),('abcus','https://abcnews.go.com/abcnews/usheadlines'),('abcinternational','https://abcnews.go.com/abcnews/internationalheadlines'),('abcpolitics','https://abcnews.go.com/abcnews/politicsheadlines'),('abcbusiness','https://abcnews.go.com/abcnews/businessheadlines'),('abctech','https://abcnews.go.com/abcnews/technologyheadlines'),('abchealth','https://abcnews.go.com/abcnews/healthheadlines'),('abcentertainment','https://abcnews.go.com/abcnews/entertainmentheadlines'),('abctravel','https://abcnews.go.com/abcnews/travelheadlines'),('abcworld','https://abcnews.go.com/abcnews/worldheadlines'),
('foxnews','https://moxie.foxnews.com/google-publisher/latest.xml'),('foxworld','https://moxie.foxnews.com/google-publisher/world.xml'),('foxus','https://moxie.foxnews.com/google-publisher/us.xml'),('foxpolitics','https://moxie.foxnews.com/google-publisher/politics.xml'),('foxscience','https://moxie.foxnews.com/google-publisher/science.xml'),('foxhealth','https://moxie.foxnews.com/google-publisher/health.xml'),('foxsports','https://moxie.foxnews.com/google-publisher/sports.xml'),('foxtech','https://moxie.foxnews.com/google-publisher/tech.xml'),('foxtravel','https://moxie.foxnews.com/google-publisher/travel.xml'),('foxvideo','https://moxie.foxnews.com/google-publisher/videos.xml'),
('standardheadlines','https://www.standardmedia.co.ke/rss/headlines.php'),('standardke','https://www.standardmedia.co.ke/rss/kenya.php'),('standardworld','https://www.standardmedia.co.ke/rss/world.php'),('standardpolitics','https://www.standardmedia.co.ke/rss/politics.php'),('standardopinion','https://www.standardmedia.co.ke/rss/opinion.php'),('standardsports','https://www.standardmedia.co.ke/rss/sports.php'),('standardbusiness','https://www.standardmedia.co.ke/rss/business.php'),('standardagri','https://www.standardmedia.co.ke/rss/agriculture.php'),('standardktn','https://www.standardmedia.co.ke/rss/ktnvideos.php'),('standardent','https://www.standardmedia.co.ke/rss/entertainment.php'),('nationafrica','https://nation.africa/kenya/rss'),('citizendigital','https://citizen.digital/rss'),('capitalfm','https://www.capitalfm.co.ke/news/feed/'),('kbc','https://www.kbc.co.ke/feed/'),('tuko','https://www.tuko.co.ke/rss'),('mpasho','https://mpasho.co.ke/feed/'),('thestar','https://www.the-star.co.ke/rss/'),('businessdailyafrica','https://www.businessdailyafrica.com/rss'),('techweez','https://techweez.com/feed/'),('cioafrica','https://cioafrica.co/feed/'),
('billboard','https://www.billboard.com/feed/'),('billboardmusic','https://www.billboard.com/articles/rss.xml'),('rollingstone','https://www.rollingstone.com/feed/'),('rollingstonemusic','https://www.rollingstone.com/music/feed/'),('pitchfork','https://pitchfork.com/feed/rss'),('nprmusic','https://feeds.npr.org/1039/rss.xml'),('mbw','https://www.musicbusinessworldwide.com/feed/'),('edmcom','https://edm.com/.rss/full/'),('metalinjection','https://feeds.feedburner.com/metalinjection'),('songexploder','https://songexploder.net/feed'),('youredm','https://www.youredm.com/feed/'),('consequence','https://consequence.net/feed/'),('stereogum','https://stereogum.com/feed'),('brooklynvegan','https://www.brooklynvegan.com/feed/'),('thefader','https://www.thefader.com/rss'),
('variety','https://variety.com/feed/'),('deadline','https://deadline.com/feed/'),('hollywoodreporter','https://www.hollywoodreporter.com/feed/'),('thewrap','https://www.thewrap.com/feed/'),('ign','https://feeds.ign.com/ign/all'),('gamespot','https://www.gamespot.com/feeds/news/'),('pcgamer','https://www.pcgamer.com/rss/'),('polygon','https://www.polygon.com/rss/index.xml'),('kotaku','https://kotaku.com/rss'),('nprpop','https://feeds.npr.org/510354/rss.xml'),('guardianculture','https://www.theguardian.com/culture/rss'),('bbcentertainment2','https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml'),('rollingstonetv','https://www.rollingstone.com/tv-movies/feed/'),('rollingstoneculture','https://www.rollingstone.com/culture/feed/'),('enews','https://www.eonline.com/syndication/feeds/rssfeeds'),
('wired','https://www.wired.com/feed/rss'),('wiredbusiness','https://www.wired.com/feed/category/business/latest/rss'),('wiredai','https://www.wired.com/feed/tag/ai/latest/rss'),('wiredscience','https://www.wired.com/feed/category/science/latest/rss'),('wiredsecurity','https://www.wired.com/feed/category/security/latest/rss'),('techcrunch','https://techcrunch.com/feed/'),('arstechnica','https://feeds.arstechnica.com/arstechnica/index'),('theverge','https://www.theverge.com/rss/index.xml'),('spacecom','https://www.space.com/feeds/all'),('popsci','https://popsci.com/rss.xml')
) v(handle,feed_url) on conflict(feed_url) do update set profile_id=excluded.profile_id,source_name=excluded.source_name,category=excluded.category,country_code=excluded.country_code,enabled=true,updated_at=now();
