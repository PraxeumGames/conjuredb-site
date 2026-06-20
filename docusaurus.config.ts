import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'ConjureDB',
  tagline: 'A compiled, zero-allocation data layer for game clients',
  favicon: 'img/favicon.ico',

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
    // TODO(brand): add img/conjuredb-social-card.png and a real logo, then set
    // `image` and a navbar `logo` here.
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'ConjureDB',
      items: [
        {to: '/why', label: 'Why ConjureDB', position: 'left'},
        {to: '/how-it-works', label: 'How it works', position: 'left'},
        {to: '/performance', label: 'Performance', position: 'left'},
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
      style: 'dark',
      links: [
        {
          title: 'Product',
          items: [
            {label: 'Why ConjureDB', to: '/why'},
            {label: 'How it works', to: '/how-it-works'},
            {label: 'Performance', to: '/performance'},
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
      copyright: `Copyright © ${new Date().getFullYear()} ConjureDB. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.oneLight,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['csharp', 'bash', 'json', 'sql', 'diff'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
