import { useEffect } from "react";
import { APP_NAME } from "@/config/appMeta";

type SEOProps = {
  title?: string;
  description?: string;
  canonical?: string;
  image?: string;
  jsonLd?: Record<string, any>;
};

export const SEO = ({ title, description, canonical, image, jsonLd }: SEOProps) => {
  const effectiveTitle = title || APP_NAME;
  useEffect(() => {
    // Title
    if (effectiveTitle) document.title = effectiveTitle;

    // Description
    if (description) {
      let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'description';
        document.head.appendChild(meta);
      }
      meta.content = description;
    }

    // Canonical
    if (canonical) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
      }
      link.href = canonical;
    }

    // Open Graph
    const setOg = (property: string, content?: string) => {
      if (!content) return;
      let meta = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('property', property);
        document.head.appendChild(meta);
      }
      meta.content = content;
    };

  setOg('og:title', effectiveTitle);
    setOg('og:description', description);
    setOg('og:image', image);

    // JSON-LD structured data
    const scriptId = 'app-jsonld';
    const existing = document.getElementById(scriptId);
    if (jsonLd) {
      const script = existing instanceof HTMLScriptElement ? existing : document.createElement('script');
      script.type = 'application/ld+json';
      script.id = scriptId;
      script.textContent = JSON.stringify(jsonLd);
      if (!existing) document.head.appendChild(script);
    } else if (existing) {
      existing.remove();
    }
  }, [effectiveTitle, description, canonical, image, jsonLd]);

  return null;
};

export default SEO;
