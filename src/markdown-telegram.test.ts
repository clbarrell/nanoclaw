import { describe, expect, it } from 'vitest';

import { convertToTelegramMarkdown } from './markdown-telegram.js';

describe('convertToTelegramMarkdown', () => {
  describe('basic formatting', () => {
    it('converts bold **text** to *text*', () => {
      expect(convertToTelegramMarkdown('Hello **world**')).toBe(
        'Hello *world*',
      );
    });

    it('converts italic *text* to _text_', () => {
      expect(convertToTelegramMarkdown('Hello *world*')).toBe(
        'Hello _world_',
      );
    });

    it('converts strikethrough ~~text~~ to ~text~', () => {
      expect(convertToTelegramMarkdown('Hello ~~world~~')).toBe(
        'Hello ~world~',
      );
    });

    it('converts bold+italic ***text*** to *_text_*', () => {
      expect(convertToTelegramMarkdown('Hello ***world***')).toBe(
        'Hello *_world_*',
      );
    });
  });

  describe('headings', () => {
    it('converts h1 to bold', () => {
      expect(convertToTelegramMarkdown('# Title')).toBe('*Title*');
    });

    it('converts h2 to bold', () => {
      expect(convertToTelegramMarkdown('## Subtitle')).toBe('*Subtitle*');
    });

    it('converts h3 to bold', () => {
      expect(convertToTelegramMarkdown('### Section')).toBe('*Section*');
    });
  });

  describe('code', () => {
    it('preserves inline code without escaping non-code chars', () => {
      // Per Telegram rules: only ` and \ need escaping inside code entities
      expect(convertToTelegramMarkdown('Use `foo.bar()` here')).toBe(
        'Use `foo.bar()` here',
      );
    });

    it('preserves fenced code blocks', () => {
      const input = '```python\nprint("hello")\n```';
      const result = convertToTelegramMarkdown(input);
      // Only ` and \ are escaped inside code blocks
      expect(result).toBe('```python\nprint("hello")\n```');
    });

    it('does not escape special chars inside code blocks', () => {
      const input = '```\nfoo_bar = 1 + 2\n```';
      const result = convertToTelegramMarkdown(input);
      // Only ` and \ are escaped inside code blocks
      expect(result).toBe('```\nfoo_bar = 1 + 2\n```');
    });

    it('escapes backticks inside code blocks', () => {
      const input = '```\nuse `inner` here\n```';
      const result = convertToTelegramMarkdown(input);
      expect(result).toContain('\\`inner\\`');
    });
  });

  describe('links', () => {
    it('preserves link syntax with URL escaping', () => {
      // Per Telegram rules: only ) and \ need escaping inside link URLs
      const input = 'Visit [Google](https://google.com)';
      const result = convertToTelegramMarkdown(input);
      expect(result).toBe('Visit [Google](https://google.com)');
    });

    it('escapes special chars in link text', () => {
      const input = '[foo_bar](https://example.com)';
      const result = convertToTelegramMarkdown(input);
      expect(result).toContain('[foo\\_bar]');
    });

    it('escapes parentheses in URLs', () => {
      const input = '[wiki](https://en.wikipedia.org/wiki/Foo_(bar))';
      const result = convertToTelegramMarkdown(input);
      expect(result).toContain('Foo_(bar\\)');
    });
  });

  describe('lists', () => {
    it('escapes bullet list markers', () => {
      const input = '- item one\n- item two';
      const result = convertToTelegramMarkdown(input);
      expect(result).toBe('\\- item one\n\\- item two');
    });

    it('escapes numbered list dots', () => {
      const input = '1. first\n2. second';
      const result = convertToTelegramMarkdown(input);
      expect(result).toBe('1\\. first\n2\\. second');
    });
  });

  describe('blockquotes', () => {
    it('preserves blockquote markers', () => {
      const input = '> This is a quote';
      const result = convertToTelegramMarkdown(input);
      expect(result).toBe('>This is a quote');
    });
  });

  describe('special character escaping', () => {
    it('escapes dots in plain text', () => {
      expect(convertToTelegramMarkdown('Hello world.')).toBe('Hello world\\.');
    });

    it('escapes exclamation marks', () => {
      expect(convertToTelegramMarkdown('Wow!')).toBe('Wow\\!');
    });

    it('escapes parentheses in plain text', () => {
      expect(convertToTelegramMarkdown('foo (bar)')).toBe('foo \\(bar\\)');
    });

    it('escapes hash in plain text', () => {
      expect(convertToTelegramMarkdown('Issue #123')).toBe('Issue \\#123');
    });

    it('escapes plus sign', () => {
      expect(convertToTelegramMarkdown('1 + 2')).toBe('1 \\+ 2');
    });

    it('escapes equals sign', () => {
      expect(convertToTelegramMarkdown('a = b')).toBe('a \\= b');
    });

    it('escapes pipe', () => {
      expect(convertToTelegramMarkdown('a | b')).toBe('a \\| b');
    });

    it('escapes curly braces', () => {
      expect(convertToTelegramMarkdown('{key}')).toBe('\\{key\\}');
    });
  });

  describe('mixed content', () => {
    it('handles bold with special chars', () => {
      const input = '**Hello world!** More text.';
      const result = convertToTelegramMarkdown(input);
      expect(result).toBe('*Hello world\\!* More text\\.');
    });

    it('handles a typical Claude response', () => {
      const input =
        "Here's what I found:\n\n" +
        '## Summary\n\n' +
        "- **Item 1**: It's working.\n" +
        '- **Item 2**: Check `config.ts` for details.\n\n' +
        'See [docs](https://example.com/docs) for more info.';
      const result = convertToTelegramMarkdown(input);
      // Should not throw and should produce valid MarkdownV2
      expect(result).toBeTruthy();
      // Bold markers should be single *
      expect(result).toContain('*Item 1*');
      expect(result).toContain('*Item 2*');
      // Heading should be bold
      expect(result).toContain('*Summary*');
      // Inline code preserved
      // Inline code: only ` and \ escaped inside
      expect(result).toContain('`config.ts`');
      // Link preserved (only ) and \ escaped in URL)
      expect(result).toContain('[docs](https://example.com/docs)');
    });
  });

  describe('edge cases', () => {
    it('returns empty string for empty input', () => {
      expect(convertToTelegramMarkdown('')).toBe('');
    });

    it('handles text with no markdown', () => {
      expect(convertToTelegramMarkdown('Just plain text')).toBe(
        'Just plain text',
      );
    });

    it('handles horizontal rules', () => {
      const result = convertToTelegramMarkdown('---');
      expect(result).toBe('\\-\\-\\-');
    });
  });
});
