/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TM_MODEL_URL?: string;
  readonly VITE_FORMSPREE_ENDPOINT?: string;
  readonly VITE_DISQUS_SHORTNAME?: string;
  readonly VITE_DISQUS_IDENTIFIER?: string;
  readonly VITE_GISCUS_REPO?: string;
  readonly VITE_GISCUS_REPO_ID?: string;
  readonly VITE_GISCUS_CATEGORY?: string;
  readonly VITE_GISCUS_CATEGORY_ID?: string;
}
