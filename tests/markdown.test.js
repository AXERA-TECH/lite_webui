import { describe, it, expect } from 'vitest';
import { renderMarkdown, fixLiteralEscapes } from '../src/markdown.js';

// Helper: does the output contain rendered KaTeX HTML (not raw LaTeX)?
function isKatexRendered(html) {
  return html.includes('katex') || html.includes('class="mord"');
}

// Helper: does the output contain the raw LaTeX string (indicating it was NOT rendered)?
function containsRaw(html, rawStr) {
  // Strip HTML tags to get text content
  const text = html.replace(/<[^>]+>/g, '');
  return text.includes(rawStr);
}

describe('renderMarkdown – LaTeX rendering', () => {
  it('renders standard inline math $...$', () => {
    const html = renderMarkdown('The value is $\\frac{3}{4}$.');
    expect(isKatexRendered(html)).toBe(true);
    expect(containsRaw(html, '\\frac')).toBe(false);
  });

  it('renders standard display math $$...$$', () => {
    const html = renderMarkdown('$$A_n = \\sum_{k=1}^n k$$');
    expect(isKatexRendered(html)).toBe(true);
    expect(containsRaw(html, '\\sum')).toBe(false);
  });

  it('wraps bare \\cmd{...} fragment in $...$ (existing behaviour)', () => {
    const html = renderMarkdown('See \\underline{\\text{compare this}}');
    expect(isKatexRendered(html)).toBe(true);
  });

  it('renders compact OCR-style math expression with no $ delimiters', () => {
    // OCR model output: entire expression without $
    const input = '(A_{n}=a_{0}\\left[1+\\frac{3}{4}\\sum_{k=1}^{n}\\left(\\frac{4}{9}\\right)^{k}\\right])';
    const html = renderMarkdown(input);
    expect(isKatexRendered(html)).toBe(true);
    // Should not leave raw \frac or \sum in output
    expect(containsRaw(html, '\\frac')).toBe(false);
    expect(containsRaw(html, '\\sum')).toBe(false);
    expect(containsRaw(html, '\\left')).toBe(false);
  });

  it('does NOT wrap an entire prose sentence just because it contains \\frac', () => {
    const input = 'The value of the fraction \\frac{3}{4} is important.';
    const html = renderMarkdown(input);
    // The fraction should be rendered
    expect(isKatexRendered(html)).toBe(true);
    // But prose words should still be visible as plain text
    const text = html.replace(/<[^>]+>/g, '');
    expect(text).toMatch(/value|fraction|important/);
  });

  it('renders math-dense spaced expression (variable = formula)', () => {
    // e.g. OCR output with spaces: f(x) = \\frac{1}{x^2}
    const input = 'f(x) = \\frac{1}{x^2}';
    const html = renderMarkdown(input);
    expect(isKatexRendered(html)).toBe(true);
    expect(containsRaw(html, '\\frac')).toBe(false);
  });

  it('does not double-wrap already-delimited $...$ math', () => {
    const input = 'Result: $\\frac{3}{4}$';
    const html = renderMarkdown(input);
    expect(isKatexRendered(html)).toBe(true);
    // Check no double-dollar or malformed nesting
    expect(html).not.toMatch(/\$\$\$|\\frac.*\$\$.*\$/);
  });

  it('does not wrap code blocks containing backslashes', () => {
    const input = '```\n\\frac{3}{4}\n```';
    const html = renderMarkdown(input);
    // Should be in a <code> block, not KaTeX
    expect(html).toMatch(/<code/);
    // The raw text should be visible (in code block)
    const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
    expect(codeMatch).not.toBeNull();
    expect(codeMatch[1]).toContain('frac');
  });

  it('renders \\(...\\) inline math delimiters (LLM/OCR output style)', () => {
    // LLMs often output \( ... \) instead of $ ... $
    const input = 'The result is \\(A_{n}=a_{0}\\left[1+\\frac{3}{4}\\sum_{k=1}^{n}\\left(\\frac{4}{9}\\right)^{k}\\right]\\)';
    const html = renderMarkdown(input);
    expect(isKatexRendered(html)).toBe(true);
    expect(containsRaw(html, '\\frac')).toBe(false);
    expect(containsRaw(html, '\\sum')).toBe(false);
    expect(containsRaw(html, '\\left')).toBe(false);
  });

  it('renders \\[...\\] display math delimiters (LLM/OCR output style)', () => {
    const input = 'Formula:\n\\[A_n = \\sum_{k=1}^n \\frac{k}{n^2}\\]';
    const html = renderMarkdown(input);
    expect(isKatexRendered(html)).toBe(true);
    expect(containsRaw(html, '\\frac')).toBe(false);
    expect(containsRaw(html, '\\sum')).toBe(false);
  });

  it('does not convert \\left( or \\right) inside \\(...\\) math', () => {
    // Ensure \left( and \right) inside the math block are preserved as KaTeX commands
    const input = '\\(\\left(\\frac{1}{2}\\right)\\)';
    const html = renderMarkdown(input);
    expect(isKatexRendered(html)).toBe(true);
    // \frac should be rendered, not raw
    expect(containsRaw(html, '\\frac')).toBe(false);
  });

  it('handles multiple \\(...\\) expressions in one text', () => {
    const input = 'First: \\(a^2\\) and second: \\(b^2\\). Sum: \\(a^2 + b^2\\).';
    const html = renderMarkdown(input);
    expect(isKatexRendered(html)).toBe(true);
  });
});

describe('fixLiteralEscapes', () => {
  it('converts literal \\n (backslash+n) to a real newline', () => {
    // "\\n" in the JS source is a two-char string: \ followed by n
    const result = fixLiteralEscapes('hello\\nworld');
    expect(result).toBe('hello\nworld');
  });

  it('converts literal \\t to a real tab', () => {
    const result = fixLiteralEscapes('col1\\tcol2');
    expect(result).toBe('col1\tcol2');
  });

  it('converts multiple literal \\n\\n sequences', () => {
    const result = fixLiteralEscapes('para1\\n\\npara2\\n\\npara3');
    expect(result).toBe('para1\n\npara2\n\npara3');
  });

  it('preserves literal \\n inside a backtick code span', () => {
    const result = fixLiteralEscapes('use `\\n` to escape');
    // The \n inside the code span must stay as backslash+n
    expect(result).toContain('`\\n`');
  });

  it('preserves literal \\n inside a fenced code block', () => {
    const result = fixLiteralEscapes('```\nprint("\\n")\n```');
    expect(result).toContain('"\\n"');
  });

  it('converts \\n outside code block but not inside', () => {
    const input = 'before\\n```\ncode\\n\n```\\nafter';
    const result = fixLiteralEscapes(input);
    // Outside code: converted
    expect(result.startsWith('before\n')).toBe(true);
    expect(result.endsWith('\nafter')).toBe(true);
    // Inside code block: preserved
    expect(result).toContain('code\\n');
  });

  it('returns the original string unchanged when there are no literal escapes', () => {
    const input = 'hello\nworld';
    expect(fixLiteralEscapes(input)).toBe(input);
  });
});

describe('renderMarkdown – literal escape sequences from backends', () => {
  it('renders paragraphs when model returns literal \\n\\n (double-escaped JSON)', () => {
    // Some backends double-encode the JSON so real newlines become backslash+n
    const input = '第一段文字。\\n\\n第二段文字。';
    const html = renderMarkdown(input);
    // Should produce paragraph tags (not display raw \n\n as text)
    expect(html).toMatch(/<p>/);
    expect(html).not.toContain('\\n');
  });

  it('renders a numbered list when items separated by literal \\n', () => {
    const input = '1. Item one\\n2. Item two\\n3. Item three';
    const html = renderMarkdown(input);
    expect(html).toMatch(/<ol|<li/);
  });

  it('preserves literal \\n inside an inline code span even after renderMarkdown', () => {
    const input = 'In shell: `echo \\n` is a literal.';
    const html = renderMarkdown(input);
    expect(html).toContain('\\n');
  });
});
