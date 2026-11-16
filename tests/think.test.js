import { afterEach, describe, expect, it } from 'vitest';
import { parseThinkStream } from '../src/markdown.js';
import { Chat } from '../src/components/chat.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('think boundaries', () => {
  it('keeps normal complete, unclosed and untagged responses compatible', () => {
    expect(parseThinkStream('<think> reason </think> answer')).toEqual({ thinkText: 'reason', mainText: 'answer', inThink: false, thinkComplete: true });
    expect(parseThinkStream('<think>partial')).toEqual({ thinkText: 'partial', mainText: '', inThink: true, thinkComplete: false });
    expect(parseThinkStream('Thinking Process: plain response')).toEqual({ thinkText: '', mainText: 'Thinking Process: plain response', inThink: false, thinkComplete: false });
  });

  it('recognizes an omitted opening tag only after a complete closing boundary arrives', () => {
    const prefix = 'thinking text';
    for (let end = 0; end < '</think>'.length; end++) {
      const text = prefix + '</think>'.slice(0, end);
      expect(parseThinkStream(text)).toMatchObject({ thinkText: '', mainText: text, inThink: false, thinkComplete: false });
    }
    expect(parseThinkStream(prefix + '</think>final answer')).toEqual({ thinkText: prefix, mainText: 'final answer', inThink: false, thinkComplete: true });
  });

  it.each(['</think>answer', ' \n</think>answer', '<think> \n</think>answer'])('omits an empty thinking panel for %j', text => {
    expect(parseThinkStream(text)).toMatchObject({ thinkText: '', mainText: 'answer', thinkComplete: false });
  });

  it.each([
    'Example `</think>` stays in the answer.',
    'Example `` ` </think> `` stays in the answer.',
    '```xml\n</think>\n```\nnormal answer',
    '~~~xml\n</think>\n~~~\nnormal answer',
    '````xml\n```\n</think>\n````\nnormal answer',
    '```xml\n</think>',
    'Example:\n> ```xml\n> </think>\n> ```\nNormal answer',
    'Example:\n> ~~~xml\n> </think>\n> ~~~\nNormal answer',
    'Example:\n> ```xml\n> </think>',
    'Example:\n> ```xml\n> </think>\n> ````\nNormal answer',
    '```xml\n> ```\n</think>\n```',
    String.raw`Example \</think> stays in the answer.`,
    'Example &lt;/think&gt; stays in the answer.',
    'Example:\n\n    </think>\n\nNormal answer',
    'Example:\n\n\t</think>\n\nNormal answer',
    '    </think>\nNormal answer',
  ])('does not classify a literal Markdown example as thinking: %j', text => {
    expect(parseThinkStream(text)).toEqual({ thinkText: '', mainText: text, inThink: false, thinkComplete: false });
  });

  it('keeps indented protocol closings inside a continuing paragraph recognizable', () => {
    expect(parseThinkStream('thinking text\n    </think>answer')).toMatchObject({ thinkText: 'thinking text', mainText: 'answer' });
    expect(parseThinkStream('thinking text\n\t</think>answer')).toMatchObject({ thinkText: 'thinking text', mainText: 'answer' });
    expect(parseThinkStream('reason\n\n    </think>\n\n</think>answer')).toMatchObject({ thinkText: 'reason\n\n    </think>', mainText: 'answer' });
  });

  it('skips literal closings before the genuine boundary and ignores later literal openings', () => {
    expect(parseThinkStream('reason\n> ~~~xml\n> </think>\n> ~~~\n</think>answer')).toMatchObject({ thinkText: 'reason\n> ~~~xml\n> </think>\n> ~~~', mainText: 'answer' });
    expect(parseThinkStream('reason mentioning `</think>`\n</think>answer `<think>`')).toMatchObject({ thinkText: 'reason mentioning `</think>`', mainText: 'answer `<think>`', thinkComplete: true });
    expect(parseThinkStream('reason\n```xml\n</think>\n```\n</think>answer')).toMatchObject({ thinkText: 'reason\n```xml\n</think>\n```', mainText: 'answer' });
    expect(parseThinkStream('reason\r\n```xml\r\n</think>\r\n```\r\n</think>answer')).toMatchObject({ thinkText: 'reason\r\n```xml\r\n</think>\r\n```', mainText: 'answer' });
  });
});

describe('thinking live completion and history', () => {
  function mount() { const chat = new Chat(); document.body.appendChild(chat.render()); return chat; }
  function result(chat) {
    return { body: chat.el.querySelector('.prose-dark')?.textContent.trim() || '',
      thoughts: [...chat.el.querySelectorAll('details.think-block')].map(details => ({ open: details.open, text: details.querySelector('.think-block-content').textContent.trim() })) };
  }

  it.each(['reason</think>answer', '<think>reason</think>answer'])('folds completed thinking after arbitrary single-character streaming: %j', text => {
    const chat = mount(); chat.startAssistantMessage();
    for (const character of text) chat.appendToAssistantMessage(character);
    expect(chat.el.querySelector('.think-streaming-body').textContent).toBe('reason');
    expect(chat.el.querySelector('.prose-dark').textContent).toContain('answer');
    chat.finalizeAssistantMessage(text);
    expect(result(chat)).toEqual({ body: 'answer', thoughts: [{ open: false, text: 'reason' }] });
    const message = { role: 'assistant', content: text, timestamp: '2026-01-01T00:00:00Z' };
    chat.loadConversation({ id: 'old-conversation', messages: [message] });
    expect(result(chat)).toEqual({ body: 'answer', thoughts: [{ open: false, text: 'reason' }] });
    expect(message.content).toBe(text);
  });

  it.each(['</think>answer', ' \n</think>answer', '<think> \n</think>answer', '<think> \n'])('keeps empty thinking consistent through finalize and reload: %j', text => {
    const chat = mount(); chat.startAssistantMessage(); chat.appendToAssistantMessage(text); chat.finalizeAssistantMessage(text);
    expect(result(chat).thoughts).toEqual([]); expect(chat.el.querySelector('.prose-dark').innerHTML).not.toContain('</think>');
    const live = result(chat); chat.loadConversation({ messages: [{ role: 'assistant', content: text }] }); expect(result(chat)).toEqual(live);
  });

  it('preserves literal closing examples through completion and reload', () => {
    const text = 'Use `</think>` literally.\n\n```xml\n</think>\n```';
    const chat = mount(); chat.startAssistantMessage(); chat.appendToAssistantMessage(text); chat.finalizeAssistantMessage(text);
    expect(result(chat).thoughts).toEqual([]); expect(result(chat).body).toContain('</think>');
    const live = result(chat); chat.loadConversation({ messages: [{ role: 'assistant', content: text }] }); expect(result(chat)).toEqual(live);
  });
});
