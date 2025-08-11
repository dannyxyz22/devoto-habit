import { Helmet } from "react-helmet-async";

type SEOProps = {
  title: string;
  description?: string;
  canonical?: string;
  image?: string;
  jsonLd?: Record<string, any>;
};

export const SEO = ({ title, description, canonical, image, jsonLd }: SEOProps) => (
  <Helmet>
    <title>{title}</title>
    {description && <meta name="description" content={description} />}
    {canonical && <link rel="canonical" href={canonical} />}
    <meta property="og:title" content={title} />
    {description && <meta property="og:description" content={description} />}
    {image && <meta property="og:image" content={image} />}
    {jsonLd && (
      <script type="application/ld+json">
        {JSON.stringify(jsonLd)}
      </script>
    )}
  </Helmet>
);

export default SEO;
