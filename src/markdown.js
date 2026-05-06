import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';

// Register common languages only to keep bundle size small
import langBash from 'highlight.js/lib/languages/bash';
import langC from 'highlight.js/lib/languages/c';
import langCpp from 'highlight.js/lib/languages/cpp';
import langCss from 'highlight.js/lib/languages/css';
import langDiff from 'highlight.js/lib/languages/diff';
import langGo from 'highlight.js/lib/languages/go';
import langGraphql from 'highlight.js/lib/languages/graphql';
import langIni from 'highlight.js/lib/languages/ini';
import langJava from 'highlight.js/lib/languages/java';
import langJs from 'highlight.js/lib/languages/javascript';
import langJson from 'highlight.js/lib/languages/json';
import langKotlin from 'highlight.js/lib/languages/kotlin';
import langMarkdown from 'highlight.js/lib/languages/markdown';
import langPhp from 'highlight.js/lib/languages/php';
import langPython from 'highlight.js/lib/languages/python';
import langRuby from 'highlight.js/lib/languages/ruby';
import langRust from 'highlight.js/lib/languages/rust';
import langScss from 'highlight.js/lib/languages/scss';
import langShell from 'highlight.js/lib/languages/shell';
import langSql from 'highlight.js/lib/languages/sql';
import langSwift from 'highlight.js/lib/languages/swift';
import langTs from 'highlight.js/lib/languages/typescript';
import langXml from 'highlight.js/lib/languages/xml';
import langYaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', langBash);
hljs.registerLanguage('c', langC);
hljs.registerLanguage('cpp', langCpp);
hljs.registerLanguage('css', langCss);
hljs.registerLanguage('diff', langDiff);
hljs.registerLanguage('go', langGo);
hljs.registerLanguage('graphql', langGraphql);
hljs.registerLanguage('ini', langIni);
hljs.registerLanguage('java', langJava);
hljs.registerLanguage('javascript', langJs);
hljs.registerLanguage('js', langJs);
hljs.registerLanguage('json', langJson);
hljs.registerLanguage('kotlin', langKotlin);
hljs.registerLanguage('markdown', langMarkdown);
hljs.registerLanguage('php', langPhp);
hljs.registerLanguage('python', langPython);
hljs.registerLanguage('py', langPython);
hljs.registerLanguage('ruby', langRuby);
hljs.registerLanguage('rust', langRust);
hljs.registerLanguage('scss', langScss);
hljs.registerLanguage('shell', langShell);
hljs.registerLanguage('sh', langShell);
hljs.registerLanguage('sql', langSql);
hljs.registerLanguage('swift', langSwift);
hljs.registerLanguage('typescript', langTs);
hljs.registerLanguage('ts', langTs);
hljs.registerLanguage('xml', langXml);
hljs.registerLanguage('html', langXml);
hljs.registerLanguage('yaml', langYaml);
hljs.registerLanguage('yml', langYaml);

const renderer = new marked.Renderer();

renderer.code = function (token) {
  const code = token.text || '';
  const lang = (token.lang || '').split(/[\s.]/)[0].toLowerCase();
  let highlighted;
  try {
    if (lang && hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } else {
      highlighted = hljs.highlightAuto(code).value;
    }
  } catch {
    highlighted = escapeHtml(code);
  }
  const langLabel = lang ? `<span class="code-lang-label">${lang}</span>` : '';
  return `<div class="code-block-wrapper">${langLabel}<button class="copy-btn" aria-label="Copy code">Copy</button><pre><code class="hljs language-${lang || 'plaintext'}">${highlighted}</code></pre></div>`;
};

renderer.codespan = function (token) {
  const text = token.text || '';
  return `<code>${escapeHtml(text)}</code>`;
};

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true,
});

export function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(String(text));
  } catch {
    return escapeHtml(String(text));
  }
}

export function attachCopyButtons(container) {
  container.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pre = btn.nextElementSibling;
      const code = pre?.querySelector('code')?.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      } catch {
        btn.textContent = 'Error';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      }
    });
  });
}
