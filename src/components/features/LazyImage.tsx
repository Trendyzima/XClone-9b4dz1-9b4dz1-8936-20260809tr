import { useState, useEffect, useRef } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  onClick?: () => void;
  priority?: boolean;
}

export function LazyImage({ src, alt, className = '', onClick, priority = false }: LazyImageProps) {
  const [isLoading, setIsLoading] = useState(!priority);
  const [isInView, setIsInView] = useState(priority);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (priority) return;
    const node = imgRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px 0px', threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [priority, src]);

  useEffect(() => {
    setFailed(false);
    setIsLoading(!priority);
    setIsInView(priority);
  }, [priority, src]);

  return (
    <div className={`relative overflow-hidden ${className}`} onClick={onClick}>
      {isLoading && !failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/70 backdrop-blur-[1px]" aria-hidden="true">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground" role="img" aria-label={`Unable to load: ${alt}`}>
          <ImageOff className="w-5 h-5" />
          <span className="text-[10px]">Image unavailable</span>
        </div>
      ) : (
        <img
          ref={imgRef}
          src={isInView ? src : undefined}
          alt={alt}
          className={`block h-full w-full object-cover transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
          onLoad={() => setIsLoading(false)}
          onError={() => { setFailed(true); setIsLoading(false); }}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
        />
      )}
    </div>
  );
}
