/**
 * Swizzled from @docusaurus/theme-classic to register the ConjureDB query DSL
 * as a custom Prism language. Everything above the DSL block is the original
 * implementation (load `additionalLanguages` from the site config); the block
 * at the end defines the grammar and its aliases.
 */

import siteConfig from '@generated/docusaurus.config';
import type * as PrismNamespace from 'prismjs';
import type {Optional} from 'utility-types';

export default function prismIncludeLanguages(
  PrismObject: typeof PrismNamespace,
): void {
  const {
    themeConfig: {prism},
  } = siteConfig;
  const {additionalLanguages} = prism as {additionalLanguages: string[]};

  // Prism components work on the Prism instance on the window, while prism-
  // react-renderer uses its own Prism instance. We temporarily mount the
  // instance onto window, import components to enhance it, then remove it to
  // avoid polluting global namespace.
  const PrismBefore = globalThis.Prism;
  globalThis.Prism = PrismObject;

  additionalLanguages.forEach((lang) => {
    if (lang === 'php') {
      // eslint-disable-next-line global-require
      require('prismjs/components/prism-markup-templating.js');
    }
    // eslint-disable-next-line global-require, import/no-dynamic-require
    require(`prismjs/components/prism-${lang}`);
  });

  // ── ConjureDB query DSL ──────────────────────────────────────────────────
  // PRQL-flavoured, pipe-based: `from … | filter … | select …`, plus schema
  // (`table`), `query`/`mutation`/`system` declarations, `@param` refs and
  // `@@index` attributes, `//` comments. Used in docs as ```conjure.
  PrismObject.languages.dsl = {
    comment: {
      pattern: /\/\/.*/,
      greedy: true,
    },
    string: {
      pattern: /"(?:\\.|[^"\\\r\n])*"/,
      greedy: true,
    },
    // Schema attributes: @@index, @@unique, …
    symbol: /@@[a-zA-Z_]\w*/,
    // Query parameters (@minLevel) and field attributes (@id).
    variable: /@[a-zA-Z_]\w*/,
    keyword:
      /\b(?:aggregate|as|checked|command|delete|derive|distinct|ephemeral|enum|event|except|exists|filter|first|first_or_default|from|full|generate|group|import|in|insert|intersect|join|left|let|map|module|mutation|not|over|pooled|query|range|reactive|require|return|right|rows|sample|select|seq|shuffle|single|single_or_default|singleton|skip|sort|struct|system|table|take|type|union|unchecked|upsert|using|view|where)\b/,
    boolean: /\b(?:false|null|true)\b/,
    // Built-in scalar types in signatures / schema fields.
    'class-name':
      /\b(?:bool|byte|char|date|datetime|decimal|double|float|guid|int|long|short|string|timespan|uint|ulong)\b/,
    // Calls and declaration names: Name(, .Any(, .Count(, query Foo(…).
    function: /\b[A-Za-z_]\w*(?=\()/,
    number: /\b\d+(?:\.\d+)?\b/,
    // Pipe `|`, lambda `=>`, return `->`, comparisons, arithmetic.
    operator: /=>|->|==|!=|>=|<=|&&|\|\||[-+*/%<>=|]/,
    punctuation: /[{}[\];(),.:]/,
  };
  PrismObject.languages.conjure = PrismObject.languages.dsl;
  // The docs historically tagged DSL snippets as ```prql; alias so they
  // highlight with the real ConjureDB grammar instead of rendering plain.
  PrismObject.languages.prql = PrismObject.languages.dsl;

  // Clean up and eventually restore former globalThis.Prism object (if any)
  delete (globalThis as Optional<typeof globalThis, 'Prism'>).Prism;
  if (typeof PrismBefore !== 'undefined') {
    globalThis.Prism = PrismObject;
  }
}
