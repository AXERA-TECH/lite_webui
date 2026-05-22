import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import 'katex/dist/katex.min.css';
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

// marked v12 uses the legacy renderer API: code(code, lang, escaped) and codespan(code)
renderer.code = function (code, lang, _escaped) {
  code = code || '';
  lang = ((lang || '').split(/[\s.]/)[0] || '').toLowerCase();
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

renderer.codespan = function (code) {
  return `<code>${escapeHtml(code || '')}</code>`;
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

// Enable KaTeX math rendering: $...$ for inline, $$...$$ for block.
// nonStandard: true allows $ adjacent to punctuation (e.g. "($x$)") which the standard
// mode skips due to its strict space/position requirements around delimiters.
marked.use(markedKatex({ throwOnError: false, output: 'html', nonStandard: true }));

/**
 * Converts \(...\) and \[...\] LaTeX math delimiters to $...$ and $$...$$
 * so marked-katex-extension can render them.
 * These forms are commonly output by LLMs and OCR models.
 * NOTE: \left( / \right) are NOT affected because the backslash there is
 * followed by letters (e.g. 'l' in 'left'), not directly by a bracket char.
 */
function convertAltMathDelimiters(text) {
  // \[...\] → $$...$$ (display math, may be multi-line)
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => `$$${inner}$$`);
  // \(...\) → $...$ (inline math)
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => `$${inner}$`);
  return text;
}


function wrapBareLaTeX(text) {
  const result = [];
  // Protect existing math ($...$, $$...$$) and code blocks (``` and `) from modification
  const protectedRe = /`{3}[\s\S]*?`{3}|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g;
  let last = 0;
  let m;
  while ((m = protectedRe.exec(text)) !== null) {
    if (m.index > last) result.push(_wrapLatexCmds(text.slice(last, m.index)));
    result.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) result.push(_wrapLatexCmds(text.slice(last)));
  return result.join('');
}

// LaTeX commands that ONLY appear in math mode — never in prose text.
// Presence of these in a line is a strong signal that the whole line is math.
const MATH_ONLY_CMDS_RE = /\\(?:frac|dfrac|tfrac|sum|int|oint|iint|iiint|prod|coprod|sqrt|binom|dbinom|tbinom|left|right|partial|nabla|infty|pm|mp|times|cdot|cdots|ldots|vdots|ddots|leq|geq|neq|approx|equiv|sim|simeq|propto|in|notin|subset|supset|subseteq|supseteq|cup|cap|bigcup|bigcap|forall|exists|nexists|emptyset|varnothing|lim|limsup|liminf|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|log|ln|exp|det|deg|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)\b/;

/**
 * Wraps \cmd{...} sequences (with up to 3 levels of nested braces) in $...$.
 *
 * Enhanced: if a line contains math-only commands AND has no English prose words
 * (3+ consecutive letters not part of a LaTeX command name), the ENTIRE line is
 * wrapped as one math expression. This handles OCR-style compact expressions like
 * "(A_{n}=a_{0}\left[1+\frac{3}{4}\sum_{k=1}^{n}...]" which contain \left, \sum, etc.
 * that don't directly follow with braces and so wouldn't be caught by the fragment regex.
 */
function _wrapLatexCmds(text) {
  return text.replace(/[^\n]+/g, line => {
    if (!line.includes('\\')) return line;

    if (MATH_ONLY_CMDS_RE.test(line)) {
      // Strip all LaTeX command names (e.g. \frac → removed), then check for prose
      const stripped = line.replace(/\\[a-zA-Z]+/g, '');
      // Prose words: 3+ consecutive letters (not inside a LaTeX command name)
      const proseWords = stripped.match(/[a-zA-Z]{3,}/g) || [];
      if (proseWords.length === 0) {
        // Math-dense line — wrap the whole trimmed line as a single expression
        const trimmed = line.trim();
        const indent = line.slice(0, line.length - line.trimStart().length);
        return `${indent}$${trimmed}$`;
      }
    }

    // Fragment wrapping: wrap individual \cmd{...}{...} patterns
    return line.replace(
      /\\[a-zA-Z]+(?:\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})+/g,
      match => `$${match}$`,
    );
  });
}

export function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(String(wrapBareLaTeX(convertAltMathDelimiters(String(text)))));
  } catch {
    return escapeHtml(String(text));
  }
}

/**
 * Splits text into think block content and main content.
 * Handles the streaming case where </think> may not have arrived yet.
 */
export function parseThinkStream(text) {
  if (!text) return { thinkText: '', mainText: '', inThink: false, thinkComplete: false };
  const openIdx = text.indexOf('<think>');
  if (openIdx === -1) {
    return { thinkText: '', mainText: text, inThink: false, thinkComplete: false };
  }
  const beforeThink = text.slice(0, openIdx);
  const afterOpen = text.slice(openIdx + 7); // '<think>'.length === 7
  const closeIdx = afterOpen.indexOf('</think>');
  if (closeIdx === -1) {
    // Still streaming inside <think>
    return { thinkText: afterOpen, mainText: beforeThink, inThink: true, thinkComplete: false };
  }
  const thinkContent = afterOpen.slice(0, closeIdx);
  // Trim leading newline/space from the text that follows </think>
  const afterClose = afterOpen.slice(closeIdx + 8).replace(/^\s+/, ''); // '</think>'.length === 8
  const trimmedThink = thinkContent.trim();
  return {
    // Empty/whitespace-only <think> blocks are treated as non-existent
    thinkText: trimmedThink,
    mainText: (beforeThink + afterClose).trim(),
    inThink: false,
    thinkComplete: trimmedThink.length > 0,
  };
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
