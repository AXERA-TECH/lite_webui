import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/markdown.js';

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
