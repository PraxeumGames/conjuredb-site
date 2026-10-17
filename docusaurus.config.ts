import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Conjure',
  tagline: 'One schema. Client, server, liveops.',
  favicon: 'img/favicon.svg',

  // .ico fallback for browsers that don't take an SVG favicon.
  headTags: [
    {tagName: 'link', attributes: {rel: 'icon', href: '/img/favicon.ico', sizes: '48x48'}},
  ],

  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Custom apex domain (see static/CNAME). The public URL is conjuredb.com.
  url: 'https://conjuredb.com',
  baseUrl: '/',
  organizationName: 'PraxeumGames',
  projectName: 'conjuredb-site',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  markdown: {
    // 'detect' parses .md as CommonMark (safe for imported docs that contain
    // bare <T> / {..} in prose) and .mdx as MDX.
    format: 'detect',
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // No edit links: the source repo carries the internal codename, so we
          // do not expose it publicly.
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Conjure',
      logo: {alt: 'Conjure', src: 'img/logo-light.svg', srcDark: 'img/logo.svg', width: 24, height: 24},
      items: [
        {to: '/platform', label: 'Platform', position: 'left'},
        {to: '/how-it-works', label: 'How it works', position: 'left'},
        {to: '/architecture', label: 'Architecture', position: 'left'},
        {to: '/data-layer', label: 'Data layer', position: 'left'},
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {to: '/docs/examples/leaderboard', label: 'Examples', position: 'left'},
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          // Brand column: mark, wordmark and one line.
          items: [
            {
              html: '<div class="cdb-footer-brand"><span class="cdb-footer-mark" aria-hidden="true"></span><span class="cdb-footer-word">Conjure</span><p>A compiled game platform for Unity &amp; .NET.</p></div>',
            },
          ],
        },
        {
          title: 'Product',
          items: [
            {label: 'Platform', to: '/platform'},
            {label: 'How it works', to: '/how-it-works'},
            {label: 'Architecture', to: '/architecture'},
            {label: 'Data layer', to: '/data-layer'},
          ],
        },
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started'},
            {label: 'Query Language', to: '/docs/query-language/reference'},
            {label: 'Examples', to: '/docs/examples/leaderboard'},
          ],
        },
        {
          title: 'Learn',
          items: [
            {label: 'Schema Language', to: '/docs/schema/schema-language'},
            {label: 'Indexing', to: '/docs/schema/indexing'},
            {label: 'Troubleshooting', to: '/docs/reference/troubleshooting'},
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Conjure`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['csharp', 'bash', 'json', 'sql', 'diff', 'ebnf'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
